pub mod audio_loopback;
pub mod deck;
pub mod win_input;

use std::collections::{BTreeMap, HashMap};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aether_host_core::{AuthDecision, AuthRateLimiter, TransferRegistry};
use aether_protocol::{
    AuthRequest, FileChunk, FileEnd, FileStart, MAX_JSON_MESSAGE_BYTES, PROTOCOL_VERSION,
    parse_and_validate,
};
use async_trait::async_trait;
use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use audio_loopback::{AudioLoopbackHub, AudioSubscription};
use base64::{Engine as _, engine::general_purpose::STANDARD, engine::general_purpose::URL_SAFE_NO_PAD};
use deck::DeckService;
use futures_util::StreamExt;
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, oneshot};

pub use win_input::{capture_screen_jpeg_for_monitor, monitors_count};
pub type TlsServerConfig = tokio_rustls::rustls::ServerConfig;

pub fn capture_screen_jpeg(quality: u8) -> Result<Vec<u8>, String> {
    capture_screen_jpeg_for_monitor(quality, 0, None).map(|(bytes, _, _, _)| bytes)
}

pub enum DualStream {
    Plain(TcpStream),
    Tls(tokio_rustls::server::TlsStream<TcpStream>),
}

impl AsyncRead for DualStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            DualStream::Plain(s) => Pin::new(s).poll_read(cx, buf),
            DualStream::Tls(s) => Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for DualStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            DualStream::Plain(s) => Pin::new(s).poll_write(cx, buf),
            DualStream::Tls(s) => Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            DualStream::Plain(s) => Pin::new(s).poll_flush(cx),
            DualStream::Tls(s) => Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            DualStream::Plain(s) => Pin::new(s).poll_shutdown(cx),
            DualStream::Tls(s) => Pin::new(s).poll_shutdown(cx),
        }
    }
}

pub fn generate_self_signed_cert_with_der(
    san_entries: &[String],
) -> Result<(tokio_rustls::rustls::ServerConfig, String, Vec<u8>, Vec<u8>), Box<dyn std::error::Error + Send + Sync>>
{
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();

    let mut subject_alt_names = Vec::new();
    for san in san_entries {
        if let Ok(ip) = san.parse::<IpAddr>() {
            subject_alt_names.push(rcgen::SanType::IpAddress(ip));
        } else if let Ok(dns) = san.clone().try_into() {
            subject_alt_names.push(rcgen::SanType::DnsName(dns));
        }
    }
    if subject_alt_names.is_empty()
        && let Ok(dns) = "localhost".to_string().try_into()
    {
        subject_alt_names.push(rcgen::SanType::DnsName(dns));
    }

    let mut params = rcgen::CertificateParams::default();
    let mut distinguished_name = rcgen::DistinguishedName::new();
    distinguished_name.push(rcgen::DnType::CommonName, "Aether Remote Host");
    params.distinguished_name = distinguished_name;
    let days_now = (now_millis() / 86_400_000) as i64;
    let (nb_y, nb_m, nb_d) = days_to_ymd(days_now.saturating_sub(1));
    let (na_y, na_m, na_d) = days_to_ymd(days_now + 3650);
    params.not_before = rcgen::date_time_ymd(nb_y, nb_m, nb_d);
    params.not_after = rcgen::date_time_ymd(na_y, na_m, na_d);
    params.key_usages = vec![
        rcgen::KeyUsagePurpose::DigitalSignature,
        rcgen::KeyUsagePurpose::KeyEncipherment,
    ];
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    params.subject_alt_names = subject_alt_names;
    let key_pair = rcgen::KeyPair::generate()?;
    let cert = params.self_signed(&key_pair)?;
    let cert_der = cert.der().to_vec();
    let key_der = key_pair.serialize_der();

    let (server_config, fingerprint) = server_config_from_der(cert_der.clone(), key_der.clone())?;
    Ok((server_config, fingerprint, cert_der, key_der))
}

fn days_to_ymd(days_since_unix_epoch: i64) -> (i32, u8, u8) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (year, m as u8, d as u8)
}

fn ymd_hms_to_unix_secs(year: i64, month: u64, day: u64, hour: u64, min: u64, sec: u64) -> Option<i64> {
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || min > 59
        || sec > 60
    {
        return None;
    }
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let m_adj = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * m_adj + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + (doe as i64) - 719_468;
    Some(days * 86_400 + (hour as i64) * 3600 + (min as i64) * 60 + (sec as i64))
}

fn read_der_tlv<'a>(data: &'a [u8]) -> Option<(u8, &'a [u8], &'a [u8])> {
    let &tag = data.first()?;
    let &len_byte = data.get(1)?;
    let (len, header_len) = if len_byte & 0x80 == 0 {
        (len_byte as usize, 2usize)
    } else {
        let num_octets = (len_byte & 0x7f) as usize;
        if num_octets == 0 || num_octets > 4 || data.len() < 2 + num_octets {
            return None;
        }
        let mut len = 0usize;
        for &b in &data[2..2 + num_octets] {
            len = (len << 8) | (b as usize);
        }
        (len, 2 + num_octets)
    };
    let end = header_len.checked_add(len)?;
    if end > data.len() {
        return None;
    }
    Some((tag, &data[header_len..end], &data[end..]))
}

fn parse_asn1_time(tag: u8, bytes: &[u8]) -> Option<i64> {
    let s = std::str::from_utf8(bytes).ok()?;
    if !s.is_ascii() {
        return None;
    }
    let (year_len, year_offset) = match tag {
        0x17 => {
            if s.len() < 13 || !s.ends_with('Z') {
                return None;
            }
            let yy: i64 = s[0..2].parse().ok()?;
            let yr = if yy >= 50 { 1900 + yy } else { 2000 + yy };
            (2usize, Some(yr))
        }
        0x18 => {
            if s.len() < 15 || !s.ends_with('Z') {
                return None;
            }
            (4usize, None)
        }
        _ => return None,
    };
    let year: i64 = match year_offset {
        Some(y) => y,
        None => s[0..4].parse().ok()?,
    };
    let rest = &s[year_len..];
    let month: u64 = rest[0..2].parse().ok()?;
    let day: u64 = rest[2..4].parse().ok()?;
    let hour: u64 = rest[4..6].parse().ok()?;
    let min: u64 = rest[6..8].parse().ok()?;
    let sec: u64 = rest[8..10].parse().ok()?;
    ymd_hms_to_unix_secs(year, month, day, hour, min, sec)
}

fn cert_validity_window_unix_secs(cert_der: &[u8]) -> Option<(i64, i64)> {
    let (tag, cert_body, _) = read_der_tlv(cert_der)?;
    if tag != 0x30 {
        return None;
    }
    let (tbs_tag, tbs_body, _) = read_der_tlv(cert_body)?;
    if tbs_tag != 0x30 {
        return None;
    }
    let mut cursor = tbs_body;
    // Optional explicit [0] version
    if let Some((0xa0, _, rest)) = read_der_tlv(cursor) {
        cursor = rest;
    }
    // serialNumber, signature AlgorithmIdentifier, issuer Name
    for expected_tag in [0x02u8, 0x30, 0x30] {
        let (t, _, rest) = read_der_tlv(cursor)?;
        if t != expected_tag {
            return None;
        }
        cursor = rest;
    }
    // validity SEQUENCE { notBefore, notAfter }
    let (val_tag, val_body, _) = read_der_tlv(cursor)?;
    if val_tag != 0x30 {
        return None;
    }
    let (nb_tag, nb_bytes, after_nb) = read_der_tlv(val_body)?;
    let (na_tag, na_bytes, _) = read_der_tlv(after_nb)?;
    let not_before = parse_asn1_time(nb_tag, nb_bytes)?;
    let not_after = parse_asn1_time(na_tag, na_bytes)?;
    Some((not_before, not_after))
}

pub fn cert_is_currently_valid(cert_der: &[u8], min_remaining_secs: u64) -> bool {
    let Some((not_before, not_after)) = cert_validity_window_unix_secs(cert_der) else {
        return false;
    };
    let now_secs = (now_millis() / 1000) as i64;
    let margin = i64::try_from(min_remaining_secs).unwrap_or(i64::MAX);
    not_before <= now_secs && not_after.saturating_sub(margin) >= now_secs
}

pub fn server_config_from_der(
    cert_der: Vec<u8>,
    key_der: Vec<u8>,
) -> Result<(tokio_rustls::rustls::ServerConfig, String), Box<dyn std::error::Error + Send + Sync>> {
    use rustls_pki_types::{CertificateDer, PrivateKeyDer};
    use sha2::{Digest, Sha256};

    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();

    let digest = Sha256::digest(&cert_der);
    let mut fp_hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(&mut fp_hex, "{:02X}", byte);
    }
    let fingerprint = format!("SHA256:{fp_hex}");

    let cert_der_pki = CertificateDer::from(cert_der);
    let key_der_pki = PrivateKeyDer::try_from(key_der)
        .map_err(|e| format!("invalid private key: {e:?}"))?;

    let server_config = tokio_rustls::rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert_der_pki], key_der_pki)?;

    Ok((server_config, fingerprint))
}

pub fn generate_self_signed_cert(
    san_entries: &[String],
) -> Result<(tokio_rustls::rustls::ServerConfig, String), Box<dyn std::error::Error + Send + Sync>> {
    let (sc, fp, _, _) = generate_self_signed_cert_with_der(san_entries)?;
    Ok((sc, fp))
}

pub const RUST_HOST_CAPABILITIES: &[&str] = &[
    "file-transfer-v2",
    "binary-screen-v1",
    "binary-audio-pcm16-v1",
    "aether-deck-v1",
    "clipboard-history-v1",
];

const SESSION_TOKEN_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedTokenRecord {
    pub token: String,
    pub device_name: String,
    pub ip_address: String,
    pub trusted: bool,
    pub issued_at_ms: u64,
    pub last_used_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClientSummary {
    pub id: u64,
    pub ip_address: String,
    pub device_model: String,
    pub capabilities: Vec<String>,
    pub streaming: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingRequest {
    pub request_id: String,
    pub client_ip: String,
    pub device_model: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Approval {
    pub approved: bool,
    pub trusted: bool,
}

#[async_trait]
pub trait ApprovalGate: Send + Sync + 'static {
    async fn approve(&self, request: PairingRequest) -> Approval;
    async fn cancel(&self, _request_id: &str) {}
}

#[async_trait]
pub trait TelemetryProvider: Send + Sync + 'static {
    async fn snapshot(&self, connected_clients: usize) -> Value;
}

#[async_trait]
pub trait ClipboardProvider: Send + Sync + 'static {
    async fn read_text(&self) -> Result<String, String>;
    async fn write_text(&self, text: String) -> Result<(), String>;
}

#[async_trait]
pub trait MediaProvider: Send + Sync + 'static {
    async fn control(&self, command: String, value: Option<u8>) -> Result<Value, String>;
}

pub trait HostEventSink: Send + Sync + 'static {
    fn on_client_authenticated(&self, _client: &ConnectedClientSummary) {}
    fn on_client_disconnected(&self, _ip: &str, _remaining: usize) {}
    fn on_tokens_changed(&self, _tokens: &[TrustedTokenRecord]) {}
    fn on_pairing_decision(&self, _approved: bool) {}
    fn on_file_received(&self, _file_name: &str, _file_path: &Path, _size: u64) {}
    fn on_outgoing_file_ack(&self, _action: &str, _fields: &BTreeMap<String, Value>) {}
    fn on_clipboard_written_by_remote(&self, _text: &str) {}
    fn on_toast(&self, _title: &str, _message: &str) {}
    fn on_stream_frame_preview(&self, _jpeg_base64: &str) {}
}

#[derive(Debug, Default)]
pub struct NoClipboard;

#[derive(Debug, Default)]
pub struct NoMedia;

#[async_trait]
impl ClipboardProvider for NoClipboard {
    async fn read_text(&self) -> Result<String, String> {
        Err("clipboard provider is unavailable".to_owned())
    }

    async fn write_text(&self, _text: String) -> Result<(), String> {
        Err("clipboard provider is unavailable".to_owned())
    }
}

#[async_trait]
impl MediaProvider for NoMedia {
    async fn control(&self, _command: String, _value: Option<u8>) -> Result<Value, String> {
        Err("media provider is unavailable".to_owned())
    }
}

#[derive(Debug, Default)]
pub struct EmptyTelemetry;

#[async_trait]
impl TelemetryProvider for EmptyTelemetry {
    async fn snapshot(&self, connected_clients: usize) -> Value {
        json!({
            "cpu": 0.0,
            "ram": 0.0,
            "ramUsedGb": 0.0,
            "ramTotalGb": 0.0,
            "net_upload": 0.0,
            "net_download": 0.0,
            "hostname": "",
            "uptime": 0,
            "monitorsCount": monitors_count(),
            "track": "",
            "artist": "",
            "isPlaying": false,
            "isScreenStreaming": false,
            "volume": 50,
            "isMuted": false,
            "connectedClients": connected_clients
        })
    }
}

pub struct ServerConfig {
    pub pin: Arc<dyn Fn() -> String + Send + Sync>,
    pub pin_validator: Option<Arc<dyn Fn(&str) -> bool + Send + Sync>>,
    pub hostname: String,
    pub mac: String,
    pub port: u16,
    pub download_folder: PathBuf,
    pub dynamic_download_folder: Option<Arc<RwLock<PathBuf>>>,
    pub approval_gate: Arc<dyn ApprovalGate>,
    pub telemetry: Arc<dyn TelemetryProvider>,
    pub clipboard: Arc<dyn ClipboardProvider>,
    pub media: Arc<dyn MediaProvider>,
    pub tls_config: Option<(tokio_rustls::rustls::ServerConfig, String)>,
    pub tls_fingerprint: Option<String>,
    pub persisted_tokens: Vec<TrustedTokenRecord>,
    pub events: Option<Arc<dyn HostEventSink>>,
    pub deck_service: Option<Arc<DeckService>>,
    pub audio_hub: Option<AudioLoopbackHub>,
    pub outbound_tx: Option<broadcast::Sender<Value>>,
    pub require_tls_for_lan: bool,
}

enum ClientControl {
    Json(Value),
    ForceDisconnect(String),
    SetStreamEnabled(bool),
}

struct ConnectedClientEntry {
    id: u64,
    ip_address: String,
    device_model: String,
    session_token: String,
    capabilities: Vec<String>,
    streaming: Arc<AtomicBool>,
    control_tx: mpsc::UnboundedSender<ClientControl>,
}

struct SharedState {
    config: ServerConfig,
    audio_hub: AudioLoopbackHub,
    limiter: StdMutex<AuthRateLimiter>,
    trusted_tokens: StdMutex<HashMap<String, TrustedTokenRecord>>,
    clients: StdMutex<HashMap<u64, ConnectedClientEntry>>,
    next_client_id: AtomicU64,
    outbound: broadcast::Sender<Value>,
}

pub struct RunningServer {
    pub address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<std::io::Result<()>>,
    state: Arc<SharedState>,
}

impl RunningServer {
    pub fn broadcast(&self, message: Value) -> Result<usize, String> {
        self.state
            .outbound
            .send(message)
            .map_err(|_| "no mobile clients are connected".to_owned())
    }

    pub fn broadcast_to_capability(&self, capability: &str, message: Value) -> usize {
        let targets: Vec<_> = {
            let Ok(guard) = self.state.clients.lock() else {
                return 0;
            };
            guard
                .values()
                .filter(|c| c.capabilities.iter().any(|cap| cap == capability))
                .map(|c| c.control_tx.clone())
                .collect()
        };
        let mut delivered = 0;
        for tx in targets {
            if tx.send(ClientControl::Json(message.clone())).is_ok() {
                delivered += 1;
            }
        }
        delivered
    }

    pub fn capability_recipients(&self, capability: &str) -> usize {
        self.state
            .clients
            .lock()
            .map(|guard| {
                guard
                    .values()
                    .filter(|c| c.capabilities.iter().any(|cap| cap == capability))
                    .count()
            })
            .unwrap_or(0)
    }

    pub fn connected_clients_snapshot(&self) -> Vec<ConnectedClientSummary> {
        self.state
            .clients
            .lock()
            .map(|guard| {
                guard
                    .values()
                    .map(|c| ConnectedClientSummary {
                        id: c.id,
                        ip_address: c.ip_address.clone(),
                        device_model: c.device_model.clone(),
                        capabilities: c.capabilities.clone(),
                        streaming: c.streaming.load(Ordering::Acquire),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn connected_clients_count(&self) -> usize {
        self.state.clients.lock().map(|g| g.len()).unwrap_or(0)
    }

    pub fn is_any_streaming(&self) -> bool {
        self.state
            .clients
            .lock()
            .map(|g| g.values().any(|c| c.streaming.load(Ordering::Acquire)))
            .unwrap_or(false)
    }

    pub fn tokens_snapshot(&self) -> Vec<TrustedTokenRecord> {
        let now = now_millis();
        self.state
            .trusted_tokens
            .lock()
            .map(|mut g| {
                g.retain(|_, rec| rec.expires_at_ms > now);
                g.values().filter(|r| r.trusted).cloned().collect()
            })
            .unwrap_or_default()
    }

    pub fn set_clients_stream_enabled(&self, enabled: bool) {
        let targets: Vec<_> = self
            .state
            .clients
            .lock()
            .ok()
            .map(|g| g.values().map(|c| c.control_tx.clone()).collect())
            .unwrap_or_default();
        for tx in targets {
            let _ = tx.send(ClientControl::SetStreamEnabled(enabled));
        }
    }

    pub fn revoke_token(&self, token_or_public_id: &str) -> bool {
        let mut revoked_tokens = Vec::new();
        let removed = self
            .state
            .trusted_tokens
            .lock()
            .ok()
            .map(|mut g| {
                let matches: Vec<String> = g
                    .keys()
                    .filter(|k| {
                        constant_time_text_eq(k, token_or_public_id)
                            || constant_time_text_eq(&token_public_id(k), token_or_public_id)
                    })
                    .cloned()
                    .collect();
                for key in &matches {
                    if let Some(rec) = g.remove(key) {
                        revoked_tokens.push(rec.token);
                    }
                }
                !revoked_tokens.is_empty()
            })
            .unwrap_or(false);
        if removed {
            let targets: Vec<_> = self
                .state
                .clients
                .lock()
                .ok()
                .map(|g| {
                    g.values()
                        .filter(|c| {
                            revoked_tokens
                                .iter()
                                .any(|rt| constant_time_text_eq(&c.session_token, rt))
                        })
                        .map(|c| c.control_tx.clone())
                        .collect()
                })
                .unwrap_or_default();
            for tx in targets {
                let _ = tx.send(ClientControl::ForceDisconnect(
                    "Trusted phone revoked".to_owned(),
                ));
            }
            if let Some(ref sink) = self.state.config.events {
                sink.on_tokens_changed(&self.tokens_snapshot());
            }
        }
        removed
    }

    pub fn disconnect_all(&self) -> usize {
        let targets: Vec<_> = self
            .state
            .clients
            .lock()
            .ok()
            .map(|g| g.values().map(|c| c.control_tx.clone()).collect())
            .unwrap_or_default();
        let count = targets.len();
        for tx in targets {
            let _ = tx.send(ClientControl::ForceDisconnect(
                "Disconnected by host operator".to_owned(),
            ));
        }
        count
    }

    pub async fn shutdown(mut self) -> std::io::Result<()> {
        if let Some(sender) = self.shutdown.take() {
            let _ = sender.send(());
        }
        self.task.await.unwrap_or_else(|error| {
            Err(std::io::Error::other(format!(
                "server task failed: {error}"
            )))
        })
    }
}

pub async fn spawn(listener: TcpListener, mut config: ServerConfig) -> std::io::Result<RunningServer> {
    let address = listener.local_addr()?;
    let outbound = config
        .outbound_tx
        .take()
        .unwrap_or_else(|| broadcast::channel(128).0);

    let (tls_acceptor, tls_fingerprint) = if let Some((sc, fp)) = config.tls_config.take() {
        (Some(tokio_rustls::TlsAcceptor::from(Arc::new(sc))), Some(fp))
    } else if let Some(ref fp) = config.tls_fingerprint {
        match generate_self_signed_cert(&[
            config.hostname.clone(),
            "127.0.0.1".to_string(),
            "localhost".to_string(),
        ]) {
            Ok((sc, generated_fp)) => (
                Some(tokio_rustls::TlsAcceptor::from(Arc::new(sc))),
                Some(generated_fp),
            ),
            Err(_) => (None, Some(fp.clone())),
        }
    } else {
        match generate_self_signed_cert(&[
            config.hostname.clone(),
            "127.0.0.1".to_string(),
            "localhost".to_string(),
        ]) {
            Ok((sc, fp)) => (Some(tokio_rustls::TlsAcceptor::from(Arc::new(sc))), Some(fp)),
            Err(_) => (None, None),
        }
    };
    config.tls_fingerprint = tls_fingerprint;

    let now = now_millis();
    let mut initial_tokens = HashMap::new();
    for rec in &config.persisted_tokens {
        if rec.expires_at_ms > now && !rec.token.is_empty() {
            initial_tokens.insert(rec.token.clone(), rec.clone());
        }
    }

    let audio_hub = config.audio_hub.take().unwrap_or_default();
    let require_tls_for_lan = config.require_tls_for_lan;

    let state = Arc::new(SharedState {
        config,
        audio_hub,
        limiter: StdMutex::new(AuthRateLimiter::default()),
        trusted_tokens: StdMutex::new(initial_tokens),
        clients: StdMutex::new(HashMap::new()),
        next_client_id: AtomicU64::new(1),
        outbound,
    });
    let router = Router::new()
        .route("/", get(websocket))
        .route("/ws", get(websocket))
        .route("/health", get(health))
        .fallback(not_found)
        .with_state(state.clone());

    let (shutdown, mut receiver) = oneshot::channel();
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut receiver => break,
                accepted = listener.accept() => {
                    let (stream, peer) = match accepted {
                        Ok(pair) => pair,
                        Err(_) => continue,
                    };
                    let acceptor = tls_acceptor.clone();
                    let router = router.clone();
                    // Handle protocol detection and TLS handshakes in per-connection tasks so a stalled peer cannot block the accept loop.
                    tokio::spawn(async move {
                        let _ = stream.set_nodelay(true);
                        let mut peek_buf = [0u8; 1];
                        let is_tls = matches!(
                            tokio::time::timeout(Duration::from_secs(5), stream.peek(&mut peek_buf)).await,
                            Ok(Ok(1)) if peek_buf[0] == 0x16
                        );
                        let dual_stream = if is_tls {
                            let Some(acc) = acceptor else { return };
                            match tokio::time::timeout(Duration::from_secs(8), acc.accept(stream)).await {
                                Ok(Ok(tls)) => DualStream::Tls(tls),
                                _ => return,
                            }
                        } else if require_tls_for_lan && acceptor.is_some() && !peer.ip().is_loopback() {
                            return;
                        } else {
                            DualStream::Plain(stream)
                        };

                        let io = hyper_util::rt::TokioIo::new(dual_stream);
                        let service = hyper_util::service::TowerToHyperService::new(tower::service_fn(
                            move |req: axum::http::Request<hyper::body::Incoming>| {
                                let mut req = req.map(axum::body::Body::new);
                                req.extensions_mut().insert(ConnectInfo(peer));
                                let mut r = router.clone();
                                async move {
                                    use tower_service::Service;
                                    r.call(req).await
                                }
                            },
                        ));
                        let builder = hyper_util::server::conn::auto::Builder::new(
                            hyper_util::rt::TokioExecutor::new(),
                        );
                        let _ = builder.serve_connection_with_upgrades(io, service).await;
                    });
                }
            }
        }
        Ok::<(), std::io::Error>(())
    });

    Ok(RunningServer {
        address,
        shutdown: Some(shutdown),
        task,
        state,
    })
}

async fn health(State(state): State<Arc<SharedState>>) -> impl IntoResponse {
    let mut payload = json!({
        "status": "ok",
        "protocolVersion": PROTOCOL_VERSION,
        "port": state.config.port,
        "secure": true,
        "host": state.config.hostname,
    });
    if let Some(ref fp) = state.config.tls_fingerprint {
        payload["tlsFingerprint"] = json!(fp);
    }
    (security_headers(), Json(payload))
}

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        security_headers(),
        Json(json!({"error": "Not found"})),
    )
}

fn security_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("cache-control", "no-store".parse().unwrap());
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("x-frame-options", "DENY".parse().unwrap());
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    headers.insert(
        "permissions-policy",
        "camera=(), microphone=(), geolocation=()".parse().unwrap(),
    );
    headers.insert(
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'"
            .parse()
            .unwrap(),
    );
    headers
}

async fn websocket(
    State(state): State<Arc<SharedState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !origin_allowed(&headers) {
        return (
            StatusCode::FORBIDDEN,
            security_headers(),
            Json(json!({"status": "AUTH_BLOCKED", "error": "Untrusted web origin"})),
        )
            .into_response();
    }
    upgrade
        .max_message_size(MAX_JSON_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, peer, state))
}

struct ClientGuard {
    state: Arc<SharedState>,
    client_id: Option<u64>,
    ip: String,
    streaming_flag: Arc<AtomicBool>,
}

impl Drop for ClientGuard {
    fn drop(&mut self) {
        self.streaming_flag.store(false, Ordering::Release);
        if let Some(id) = self.client_id {
            let remaining = if let Ok(mut guard) = self.state.clients.lock() {
                guard.remove(&id);
                guard.len()
            } else {
                0
            };
            if let Some(ref sink) = self.state.config.events {
                sink.on_client_disconnected(&self.ip, remaining);
            }
        }
    }
}

struct StreamPrefs {
    monitor_index: AtomicUsize,
    quality: AtomicU8,
    max_width: AtomicU32,
    frame_counter: AtomicU64,
    unacked_frames: AtomicUsize,
}

async fn handle_socket(mut socket: WebSocket, peer: SocketAddr, state: Arc<SharedState>) {
    let mut authenticated = false;
    let mut session_token_active = String::new();
    let mut outbound = state.outbound.subscribe();
    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<ClientControl>();
    let (stream_tx, mut stream_rx) =
        mpsc::channel::<(u64, u64, u32, u32, usize, Vec<u8>)>(2);
    let mut streaming_handle: Option<tokio::task::JoinHandle<()>> = None;
    let mut audio_sub: Option<AudioSubscription> = None;
    let mut transfer_registry = TransferRegistry::default();
    let mut incoming_files: HashMap<String, IncomingFile> = HashMap::new();
    let mut frac_dx = 0.0_f64;
    let mut frac_dy = 0.0_f64;

    let stream_prefs = Arc::new(StreamPrefs {
        monitor_index: AtomicUsize::new(0),
        quality: AtomicU8::new(65),
        max_width: AtomicU32::new(1280),
        frame_counter: AtomicU64::new(0),
        unacked_frames: AtomicUsize::new(0),
    });

    let streaming_flag = Arc::new(AtomicBool::new(false));
    let mut guard = ClientGuard {
        state: state.clone(),
        client_id: None,
        ip: peer.ip().to_string(),
        streaming_flag: streaming_flag.clone(),
    };

    loop {
        let frame = tokio::select! {
            frame = socket.next() => frame,
            ctrl = control_rx.recv() => {
                match ctrl {
                    Some(ClientControl::Json(msg)) => {
                        if send_json(&mut socket, msg).await.is_err() {
                            break;
                        }
                        continue;
                    }
                    Some(ClientControl::ForceDisconnect(reason)) => {
                        let _ = send_json(&mut socket, json!({
                            "status": "FORCE_DISCONNECTED",
                            "reason": reason
                        })).await;
                        let _ = socket.send(WsMessage::Close(None)).await;
                        break;
                    }
                    Some(ClientControl::SetStreamEnabled(start)) => {
                        streaming_flag.store(start, Ordering::Release);
                        stream_prefs.unacked_frames.store(0, Ordering::Release);
                        if start {
                            if streaming_handle.is_none() {
                                let tx = stream_tx.clone();
                                let prefs = stream_prefs.clone();
                                streaming_handle = Some(tokio::spawn(async move {
                                    let mut interval = tokio::time::interval(Duration::from_millis(66));
                                    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                                    loop {
                                        interval.tick().await;
                                        if prefs.unacked_frames.load(Ordering::Acquire) > 4 {
                                            continue;
                                        }
                                        let mon = prefs.monitor_index.load(Ordering::Acquire);
                                        let q = prefs.quality.load(Ordering::Acquire);
                                        let max_w = prefs.max_width.load(Ordering::Acquire);
                                        let cap = tokio::task::spawn_blocking(move || {
                                            capture_screen_jpeg_for_monitor(q, mon, Some(max_w))
                                        })
                                        .await;
                                        if let Ok(Ok((jpeg, w, h, _))) = cap {
                                            let fid = prefs.frame_counter.fetch_add(1, Ordering::AcqRel) + 1;
                                            if tx.try_send((fid, now_millis(), w, h, mon, jpeg)).is_ok() {
                                                prefs.unacked_frames.fetch_add(1, Ordering::AcqRel);
                                            }
                                        }
                                    }
                                }));
                            }
                        } else {
                            if let Some(handle) = streaming_handle.take() {
                                handle.abort();
                            }
                            while stream_rx.try_recv().is_ok() {}
                        }
                        let _ = send_json(&mut socket, json!({
                            "action": "STREAM_STATUS",
                            "status": "SUCCESS",
                            "enabled": start,
                            "monitorIndex": stream_prefs.monitor_index.load(Ordering::Acquire),
                            "monitorsCount": monitors_count(),
                            "quality": stream_prefs.quality.load(Ordering::Acquire)
                        })).await;
                        continue;
                    }
                    None => break,
                }
            }
            message = outbound.recv(), if authenticated => {
                match message {
                    Ok(msg) => {
                        if send_json(&mut socket, msg).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
                continue;
            }
            Some((frame_id, sent_at, width, height, monitor_idx, jpeg)) = stream_rx.recv(), if authenticated && streaming_flag.load(Ordering::Acquire) => {
                let monitors = monitors_count();
                if let Some(ref sink) = state.config.events
                    && frame_id % 3 == 1
                {
                    sink.on_stream_frame_preview(&STANDARD.encode(&jpeg));
                }
                if send_json(&mut socket, json!({
                    "action": "STREAM_FRAME_META",
                    "frameId": frame_id,
                    "sentAt": sent_at,
                    "width": width,
                    "height": height,
                    "monitorIndex": monitor_idx,
                    "monitorsCount": monitors
                })).await.is_err() {
                    break;
                }
                let mut packet = Vec::with_capacity(1 + jpeg.len());
                packet.push(0x01);
                packet.extend_from_slice(&jpeg);
                if socket.send(WsMessage::Binary(packet.into())).await.is_err() {
                    break;
                }
                continue;
            }
            audio_res = async {
                match &mut audio_sub {
                    Some(sub) => sub.receiver.recv().await,
                    None => std::future::pending().await,
                }
            }, if authenticated => {
                match audio_res {
                    Ok(packet) => {
                        if socket.send(WsMessage::Binary(packet.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => {
                        audio_sub = None;
                    }
                }
                continue;
            }
        };

        let Some(Ok(frame)) = frame else { break };
        let WsMessage::Text(text) = frame else {
            if matches!(frame, WsMessage::Close(_)) {
                break;
            }
            continue;
        };

        let parsed = match parse_and_validate(&text) {
            Ok(message) => message,
            Err(error) => {
                if send_json(
                    &mut socket,
                    json!({"status": "ERROR", "error": error.to_string()}),
                )
                .await
                .is_err()
                {
                    break;
                }
                continue;
            }
        };

        if parsed.action == "AUTH" {
            if authenticated {
                let _ = send_json(
                    &mut socket,
                    json!({"status": "ERROR", "error": "Connection is already authenticated"}),
                )
                .await;
                continue;
            }
            let request: AuthRequest = match serde_json::from_str(&text) {
                Ok(request) => request,
                Err(error) => {
                    let _ = send_json(
                        &mut socket,
                        json!({"status": "AUTH_FAILED", "error": error.to_string()}),
                    )
                    .await;
                    continue;
                }
            };
            if let Some((token, entry)) =
                authenticate(&mut socket, peer, &state, request, streaming_flag.clone(), control_tx.clone()).await
            {
                authenticated = true;
                session_token_active = token;
                let client_id = entry.id;
                guard.client_id = Some(client_id);
                let summary = ConnectedClientSummary {
                    id: client_id,
                    ip_address: entry.ip_address.clone(),
                    device_model: entry.device_model.clone(),
                    capabilities: entry.capabilities.clone(),
                    streaming: false,
                };
                if let Ok(mut clients_guard) = state.clients.lock() {
                    clients_guard.insert(client_id, entry);
                }
                if let Some(ref sink) = state.config.events {
                    sink.on_client_authenticated(&summary);
                }
            }
            continue;
        }

        if !authenticated {
            let status_payload = if parsed.action == "ACCOUNT_HELLO" || parsed.action == "ACCOUNT_PROOF" {
                json!({
                    "status": "AUTH_REJECTED",
                    "error": "Account mode is unavailable on this PC host. Pair using the QR code or 12-digit PIN."
                })
            } else {
                json!({"status": "AUTH_REQUIRED", "error": "Please authenticate first."})
            };
            if send_json(&mut socket, status_payload).await.is_err() {
                break;
            }
            continue;
        }

        let response = match parsed.action.as_str() {
            "PING" => Some(json!({
                "action": "PONG",
                "timestamp": parsed.fields.get("timestamp").cloned()
                    .filter(Value::is_number).unwrap_or_else(now_millis_value)
            })),
            "GET_TELEMETRY" => {
                let clients = state.clients.lock().map(|g| g.len()).unwrap_or(0);
                Some(json!({
                    "action": "TELEMETRY",
                    "data": state.config.telemetry.snapshot(clients).await
                }))
            }
            "CLIPBOARD" | "WRITE_CLIPBOARD" => {
                let resp = handle_clipboard_action(&parsed.fields, state.config.clipboard.as_ref()).await;
                if resp.get("action").and_then(Value::as_str) == Some("CLIPBOARD_WRITE_ACK")
                    && let Some(text_written) = resp.get("text").and_then(Value::as_str)
                    && let Some(ref sink) = state.config.events
                {
                    sink.on_clipboard_written_by_remote(text_written);
                }
                Some(resp)
            }
            "MEDIA" => Some(handle_media_action(&parsed.fields, state.config.media.as_ref()).await),
            "POWER" => {
                let cmd = parsed
                    .fields
                    .get("command")
                    .or_else(|| parsed.fields.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_ascii_uppercase();
                let res = tokio::task::spawn_blocking(move || win_input::handle_power_action(&cmd))
                    .await
                    .unwrap_or_else(|e| json!({"action": "POWER_RESPONSE", "status": "ERROR", "error": e.to_string()}));
                Some(res)
            }
            "MOUSE_MOVE" | "REMOTE_MOUSE_MOVE" => {
                let raw_dx = parsed.fields.get("dx").and_then(Value::as_f64).unwrap_or(0.0);
                let raw_dy = parsed.fields.get("dy").and_then(Value::as_f64).unwrap_or(0.0);
                frac_dx += raw_dx;
                frac_dy += raw_dy;
                let step_x = frac_dx.trunc() as i32;
                let step_y = frac_dy.trunc() as i32;
                frac_dx -= f64::from(step_x);
                frac_dy -= f64::from(step_y);
                win_input::handle_mouse_move(step_x, step_y);
                Some(json!({"action": "MOUSE_MOVE_ACK", "status": "SUCCESS"}))
            }
            "MOUSE_CLICK" | "REMOTE_MOUSE_CLICK" => {
                let btn = parsed
                    .fields
                    .get("button")
                    .or_else(|| parsed.fields.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or("left")
                    .to_owned();
                let norm_x = parsed
                    .fields
                    .get("x")
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite());
                let norm_y = parsed
                    .fields
                    .get("y")
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite());
                let mon_idx = parsed
                    .fields
                    .get("monitorIndex")
                    .or_else(|| parsed.fields.get("monitor"))
                    .and_then(Value::as_u64)
                    .map(|v| v as usize)
                    .unwrap_or_else(|| stream_prefs.monitor_index.load(Ordering::Acquire));
                win_input::handle_mouse_click_at(&btn, norm_x, norm_y, mon_idx);
                Some(json!({"action": "MOUSE_CLICK_ACK", "status": "SUCCESS"}))
            }
            "MOUSE_SCROLL" | "REMOTE_MOUSE_SCROLL" => {
                let dy = parsed
                    .fields
                    .get("dy")
                    .or_else(|| parsed.fields.get("delta"))
                    .or_else(|| parsed.fields.get("value"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .round() as i32;
                let dx = parsed
                    .fields
                    .get("dx")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .round() as i32;
                win_input::handle_mouse_scroll(dy, dx);
                Some(json!({"action": "MOUSE_SCROLL_ACK", "status": "SUCCESS"}))
            }
            "KEY_PRESS" | "REMOTE_KEY_PRESS" => {
                let text = parsed
                    .fields
                    .get("text")
                    .or_else(|| parsed.fields.get("key"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                let vk = parsed.fields.get("vk").and_then(Value::as_u64).map(|v| v as u16);
                let mut modifiers: Vec<String> = parsed
                    .fields
                    .get("modifiers")
                    .and_then(Value::as_array)
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                            .collect()
                    })
                    .unwrap_or_default();
                if parsed.fields.get("ctrl").and_then(Value::as_bool) == Some(true) {
                    modifiers.push("CTRL".to_owned());
                }
                if parsed.fields.get("alt").and_then(Value::as_bool) == Some(true) {
                    modifiers.push("ALT".to_owned());
                }
                if parsed.fields.get("shift").and_then(Value::as_bool) == Some(true) {
                    modifiers.push("SHIFT".to_owned());
                }
                if parsed.fields.get("win").and_then(Value::as_bool) == Some(true) {
                    modifiers.push("WIN".to_owned());
                }
                let _ = tokio::task::spawn_blocking(move || {
                    win_input::handle_key_press_full(text.as_deref(), vk, &modifiers);
                })
                .await;
                Some(json!({"action": "KEY_PRESS_ACK", "status": "SUCCESS"}))
            }
            "TAKE_SCREENSHOT" | "GET_SCREENSHOT" => {
                let monitor = parsed
                    .fields
                    .get("monitorIndex")
                    .or_else(|| parsed.fields.get("monitor"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as usize;
                let quality = parsed
                    .fields
                    .get("quality")
                    .and_then(Value::as_u64)
                    .unwrap_or(75)
                    .clamp(10, 100) as u8;
                let cap = tokio::task::spawn_blocking(move || {
                    capture_screen_jpeg_for_monitor(quality, monitor, None)
                })
                .await
                .unwrap_or_else(|e| Err(e.to_string()));
                match cap {
                    Ok((jpeg_bytes, width, height, monitors_total)) => {
                        let fid = stream_prefs.frame_counter.fetch_add(1, Ordering::AcqRel) + 1;
                        let _ = send_json(
                            &mut socket,
                            json!({
                                "action": "STREAM_FRAME_META",
                                "frameId": fid,
                                "sentAt": now_millis(),
                                "width": width,
                                "height": height,
                                "monitorIndex": monitor.min(monitors_total.saturating_sub(1)),
                                "monitorsCount": monitors_total
                            }),
                        )
                        .await;
                        let mut frame = Vec::with_capacity(1 + jpeg_bytes.len());
                        frame.push(0x01);
                        frame.extend_from_slice(&jpeg_bytes);
                        let _ = socket.send(WsMessage::Binary(frame.into())).await;
                        Some(json!({
                            "action": "TAKE_SCREENSHOT_RESPONSE",
                            "status": "SUCCESS",
                            "image": STANDARD.encode(&jpeg_bytes),
                            "width": width,
                            "height": height,
                            "monitorsCount": monitors_total
                        }))
                    }
                    Err(err) => Some(json!({
                        "action": "TAKE_SCREENSHOT_RESPONSE",
                        "status": "ERROR",
                        "error": err
                    })),
                }
            }
            "STREAM_FRAME" => {
                let stop_req = parsed.fields.get("start").and_then(Value::as_bool) == Some(false)
                    || parsed
                        .fields
                        .get("command")
                        .and_then(Value::as_str)
                        .is_some_and(|c| c.eq_ignore_ascii_case("STOP"));
                let start = !stop_req;
                if let Some(m) = parsed
                    .fields
                    .get("monitorIndex")
                    .or_else(|| parsed.fields.get("monitor"))
                    .and_then(Value::as_u64)
                {
                    let total = monitors_count();
                    stream_prefs
                        .monitor_index
                        .store((m as usize).min(total.saturating_sub(1)), Ordering::Release);
                }
                if let Some(q) = parsed.fields.get("quality").and_then(Value::as_u64) {
                    stream_prefs
                        .quality
                        .store(q.clamp(15, 95) as u8, Ordering::Release);
                }
                if let Some(res) = parsed.fields.get("resolution").and_then(Value::as_str) {
                    let w = match res {
                        "1080p" => 1920,
                        "480p" => 854,
                        _ => 1280,
                    };
                    stream_prefs.max_width.store(w, Ordering::Release);
                }

                streaming_flag.store(start, Ordering::Release);
                stream_prefs.unacked_frames.store(0, Ordering::Release);
                if start {
                    if streaming_handle.is_none() {
                        let tx = stream_tx.clone();
                        let prefs = stream_prefs.clone();
                        streaming_handle = Some(tokio::spawn(async move {
                            let mut interval = tokio::time::interval(Duration::from_millis(66));
                            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                            loop {
                                interval.tick().await;
                                if prefs.unacked_frames.load(Ordering::Acquire) > 4 {
                                    continue;
                                }
                                let mon = prefs.monitor_index.load(Ordering::Acquire);
                                let q = prefs.quality.load(Ordering::Acquire);
                                let max_w = prefs.max_width.load(Ordering::Acquire);
                                let cap = tokio::task::spawn_blocking(move || {
                                    capture_screen_jpeg_for_monitor(q, mon, Some(max_w))
                                })
                                .await;
                                if let Ok(Ok((jpeg, w, h, _))) = cap {
                                    let fid = prefs.frame_counter.fetch_add(1, Ordering::AcqRel) + 1;
                                    if tx.try_send((fid, now_millis(), w, h, mon, jpeg)).is_ok() {
                                        prefs.unacked_frames.fetch_add(1, Ordering::AcqRel);
                                    }
                                }
                            }
                        }));
                    }
                } else {
                    if let Some(handle) = streaming_handle.take() {
                        handle.abort();
                    }
                    while stream_rx.try_recv().is_ok() {}
                }

                Some(json!({
                    "action": "STREAM_STATUS",
                    "status": "SUCCESS",
                    "enabled": start,
                    "monitorIndex": stream_prefs.monitor_index.load(Ordering::Acquire),
                    "monitorsCount": monitors_count(),
                    "quality": stream_prefs.quality.load(Ordering::Acquire)
                }))
            }
            "FRAME_ACK" => {
                let prev = stream_prefs.unacked_frames.load(Ordering::Acquire);
                if prev > 0 {
                    stream_prefs.unacked_frames.fetch_sub(1, Ordering::AcqRel);
                }
                None
            }
            "AUDIO_STREAM" => {
                let enabled = parsed
                    .fields
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                if enabled {
                    if audio_sub.is_some() {
                        Some(json!({
                            "action": "AUDIO_STREAM_STATUS",
                            "enabled": true,
                            "status": "SUCCESS",
                            "sampleRate": 44100,
                            "channels": 2
                        }))
                    } else {
                        match state.audio_hub.subscribe_async().await {
                            Ok(sub) => {
                                audio_sub = Some(sub);
                                Some(json!({
                                    "action": "AUDIO_STREAM_STATUS",
                                    "enabled": true,
                                    "status": "SUCCESS",
                                    "sampleRate": 44100,
                                    "channels": 2
                                }))
                            }
                            Err(err) => Some(json!({
                                "action": "AUDIO_STREAM_STATUS",
                                "enabled": false,
                                "status": "ERROR",
                                "error": err
                            })),
                        }
                    }
                } else {
                    audio_sub = None;
                    Some(json!({
                        "action": "AUDIO_STREAM_STATUS",
                        "enabled": false,
                        "status": "SUCCESS"
                    }))
                }
            }
            "KILL_PROCESS" => {
                let name = parsed
                    .fields
                    .get("process_name")
                    .or_else(|| parsed.fields.get("process"))
                    .or_else(|| parsed.fields.get("name"))
                    .or_else(|| parsed.fields.get("command"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let res = tokio::task::spawn_blocking(move || win_input::handle_kill_process(&name))
                    .await
                    .unwrap_or_else(|e| json!({"action": "KILL_PROCESS_RESPONSE", "status": "ERROR", "error": e.to_string()}));
                Some(res)
            }
            "SEND_TOAST" => {
                let title = parsed
                    .fields
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Aether Remote")
                    .to_owned();
                let msg = parsed
                    .fields
                    .get("message")
                    .or_else(|| parsed.fields.get("text"))
                    .or_else(|| parsed.fields.get("command"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                if let Some(ref sink) = state.config.events {
                    sink.on_toast(&title, &msg);
                }
                let _ = tokio::task::spawn_blocking(move || {
                    win_input::show_windows_toast(&title, &msg);
                })
                .await;
                Some(json!({"action": "SEND_TOAST_RESPONSE", "status": "SUCCESS"}))
            }
            "SYSTEM" => {
                let sys_cmd = parsed
                    .fields
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_ascii_uppercase();
                if sys_cmd == "WRITE_CLIPBOARD" || sys_cmd == "READ_CLIPBOARD" || sys_cmd == "GET_CLIPBOARD" || sys_cmd == "SET_CLIPBOARD" {
                    let resp = handle_clipboard_action(&parsed.fields, state.config.clipboard.as_ref()).await;
                    if resp.get("status").and_then(Value::as_str) == Some("CLIPBOARD_WRITTEN")
                        && let Some(txt) = resp.get("text").and_then(Value::as_str)
                        && let Some(ref sink) = state.config.events
                    {
                        sink.on_clipboard_written_by_remote(txt);
                    }
                    Some(resp)
                } else if sys_cmd == "OPEN_URL" {
                    let raw = parsed
                        .fields
                        .get("target")
                        .or_else(|| parsed.fields.get("text"))
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    match url::Url::parse(raw) {
                        Ok(u) if matches!(u.scheme(), "http" | "https") => {
                            let s = u.to_string();
                            let _ = tokio::task::spawn_blocking(move || win_input::shell_open_target(&s)).await;
                            Some(json!({"action": "SYSTEM_RESPONSE", "status": "SUCCESS"}))
                        }
                        _ => Some(json!({"action": "SYSTEM_RESPONSE", "status": "ERROR", "error": "Only HTTP/HTTPS URLs are supported"})),
                    }
                } else {
                    let clients = state.clients.lock().map(|g| g.len()).unwrap_or(0);
                    Some(json!({
                        "action": "SYSTEM_RESPONSE",
                        "status": "SUCCESS",
                        "telemetry": state.config.telemetry.snapshot(clients).await
                    }))
                }
            }
            "FILE_START" | "FILE_CHUNK" | "FILE_END" | "FILE_CANCEL" => {
                let dl_folder = resolve_download_folder(&state);
                let _ = fs::create_dir_all(&dl_folder).await;
                let (resp, completed) = handle_file_action(
                    parsed.action.as_str(),
                    &text,
                    &dl_folder,
                    &mut transfer_registry,
                    &mut incoming_files,
                )
                .await;
                if let Some((fname, fpath, fsize)) = completed
                    && let Some(ref sink) = state.config.events
                {
                    sink.on_file_received(&fname, &fpath, fsize);
                }
                Some(resp)
            }
            "FILE_START_ACK" | "FILE_CHUNK_ACK" | "FILE_END_ACK" | "FILE_CANCEL_ACK" => {
                if let Some(ref sink) = state.config.events {
                    sink.on_outgoing_file_ack(parsed.action.as_str(), &parsed.fields);
                }
                None
            }
            action_str if action_str.starts_with("DECK_") => {
                if let Some(ref deck) = state.config.deck_service {
                    let ip_str = peer.ip().to_string();
                    if matches!(action_str, "DECK_TRIGGER" | "DECK_SLIDER") {
                        let deck = deck.clone();
                        let sess = session_token_active.clone();
                        let act = action_str.to_owned();
                        let fields = parsed.fields.clone();
                        let tx = control_tx.clone();
                        tokio::spawn(async move {
                            let msgs = deck.handle_ws_message(&sess, &act, &fields, &ip_str).await;
                            for m in msgs {
                                if tx.send(ClientControl::Json(m)).is_err() {
                                    break;
                                }
                            }
                        });
                        None
                    } else {
                        let msgs = deck
                            .handle_ws_message(&session_token_active, action_str, &parsed.fields, &ip_str)
                            .await;
                        let mut send_failed = false;
                        for m in msgs {
                            if send_json(&mut socket, m).await.is_err() {
                                send_failed = true;
                                break;
                            }
                        }
                        if send_failed {
                            break;
                        }
                        None
                    }
                } else {
                    Some(json!({
                        "action": "DECK_UNAVAILABLE",
                        "error": "Aether Deck service is not configured"
                    }))
                }
            }
            "WAKE_ENROLL" => Some(json!({
                "status": "WAKE_ENROLL_ERROR",
                "error": "wake_bridge_unconfigured"
            })),
            "POWERSHELL" => Some(json!({
                "action": "POWERSHELL_RESPONSE",
                "status": "ERROR",
                "error": "Direct remote PowerShell is disabled for security; use typed controls"
            })),
            _ => Some(json!({
                "status": "ERROR",
                "error": format!("Unsupported action: {}", parsed.action),
                "action": parsed.action
            })),
        };

        if let Some(response) = response
            && send_json(&mut socket, response).await.is_err()
        {
            break;
        }
    }

    if let Some(handle) = streaming_handle.take() {
        handle.abort();
    }
    drop(audio_sub);
    for transfer in incoming_files.into_values() {
        let _ = fs::remove_file(transfer.path).await;
    }
    drop(guard);
}

fn resolve_download_folder(state: &SharedState) -> PathBuf {
    if let Some(ref dynamic) = state.config.dynamic_download_folder
        && let Ok(guard) = dynamic.read()
    {
        return guard.clone();
    }
    state.config.download_folder.clone()
}

async fn handle_media_action(
    fields: &BTreeMap<String, Value>,
    media: &dyn MediaProvider,
) -> Value {
    let command = fields
        .get("command")
        .or_else(|| fields.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_uppercase();
    let allowed = [
        "VOL_SET",
        "VOLUME_SET",
        "VOL_UP",
        "VOL_DOWN",
        "VOL_MUTE",
        "NEXT_TRACK",
        "PREV_TRACK",
        "PLAY_PAUSE",
    ];
    if !allowed.contains(&command.as_str()) {
        return json!({"action": "MEDIA_RESPONSE", "status": "ERROR", "error": "Unknown media command"});
    }
    let value = fields
        .get("val")
        .or_else(|| fields.get("value"))
        .and_then(Value::as_f64)
        .map(|value| value.round().clamp(0.0, 100.0) as u8);
    match media.control(command.clone(), value).await {
        Ok(details) => {
            let mut reply = json!({
                "action": "MEDIA_RESPONSE",
                "status": "MEDIA_EXECUTED",
                "command": command,
                "data": details.clone()
            });
            if let (Some(reply_obj), Some(det_obj)) = (reply.as_object_mut(), details.as_object()) {
                for key in ["volume", "isMuted", "isPlaying", "track", "artist"] {
                    if let Some(v) = det_obj.get(key) {
                        reply_obj.insert(key.to_owned(), v.clone());
                    }
                }
            }
            reply
        }
        Err(error) => {
            json!({"action": "MEDIA_RESPONSE", "status": "ERROR", "command": command, "error": error})
        }
    }
}

async fn handle_clipboard_action(
    fields: &BTreeMap<String, Value>,
    clipboard: &dyn ClipboardProvider,
) -> Value {
    let command = fields
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_uppercase();
    let text = fields
        .get("text")
        .or_else(|| fields.get("message"))
        .or_else(|| fields.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let is_read = matches!(command.as_str(), "GET" | "GET_CLIPBOARD" | "READ_CLIPBOARD")
        || (command.is_empty() && text == "GET");
    if is_read {
        match clipboard.read_text().await {
            Ok(text) => json!({"action": "CLIPBOARD_TEXT", "text": text}),
            Err(error) => json!({"status": "ERROR", "action": "CLIPBOARD", "error": error}),
        }
    } else {
        match clipboard.write_text(text.to_owned()).await {
            Ok(()) => json!({
                "action": "CLIPBOARD_WRITE_ACK",
                "status": "CLIPBOARD_WRITTEN",
                "text": text
            }),
            Err(error) => json!({"status": "ERROR", "action": "CLIPBOARD", "error": error}),
        }
    }
}

struct IncomingFile {
    file: File,
    path: PathBuf,
    requested_name: String,
    chunk_size: u64,
    received_bytes: u64,
}

async fn handle_file_action(
    action: &str,
    text: &str,
    download_folder: &Path,
    registry: &mut TransferRegistry,
    files: &mut HashMap<String, IncomingFile>,
) -> (Value, Option<(String, PathBuf, u64)>) {
    match action {
        "FILE_START" => {
            let mut start: FileStart = match serde_json::from_str(text) {
                Ok(start) => start,
                Err(error) => return (file_error("FILE_START_ACK", "", error), None),
            };
            if start.file_id.trim().is_empty() {
                start.file_id = deck::generate_id("file");
            }
            if let Err(error) = registry.start(start.file_id.clone(), start.file_size, start.chunk_size) {
                return (file_error("FILE_START_ACK", &start.file_id, error), None);
            }
            if fs::create_dir_all(download_folder).await.is_err() {
                registry.cancel(&start.file_id);
                return (
                    file_error("FILE_START_ACK", &start.file_id, "Download folder is unavailable"),
                    None,
                );
            }
            let file_id = start.file_id.clone();
            let Ok((path, file)) = create_temporary_file(download_folder, &file_id).await else {
                registry.cancel(&file_id);
                return (
                    file_error("FILE_START_ACK", &file_id, "Failed to allocate destination file"),
                    None,
                );
            };
            files.insert(
                file_id.clone(),
                IncomingFile {
                    file,
                    path,
                    requested_name: sanitize_file_name(&start.file_name),
                    chunk_size: start.chunk_size as u64,
                    received_bytes: 0,
                },
            );
            (
                json!({
                    "action": "FILE_START_ACK",
                    "fileId": file_id,
                    "status": "SUCCESS"
                }),
                None,
            )
        }
        "FILE_CHUNK" => {
            let chunk: FileChunk = match serde_json::from_str(text) {
                Ok(chunk) => chunk,
                Err(error) => return (file_error("FILE_CHUNK_ACK", "", error), None),
            };
            let Some(incoming) = files.get_mut(&chunk.file_id) else {
                return (file_error("FILE_CHUNK_ACK", &chunk.file_id, "Unknown file transfer"), None);
            };
            let bytes = match STANDARD.decode(&chunk.data) {
                Ok(bytes) => bytes,
                Err(_) => {
                    if let Some(removed) = files.remove(&chunk.file_id) {
                        let _ = fs::remove_file(removed.path).await;
                    }
                    registry.cancel(&chunk.file_id);
                    return (
                        file_error("FILE_CHUNK_ACK", &chunk.file_id, "Chunk is not strict base64"),
                        None,
                    );
                }
            };
            let computed_offset = match chunk.offset {
                Some(v) => Some(v),
                None => match chunk.chunk_index {
                    Some(idx) => idx.checked_mul(incoming.chunk_size),
                    None => Some(incoming.received_bytes),
                },
            };
            let Some(offset) = computed_offset else {
                if let Some(removed) = files.remove(&chunk.file_id) {
                    let _ = fs::remove_file(removed.path).await;
                }
                registry.cancel(&chunk.file_id);
                return (
                    file_error("FILE_CHUNK_ACK", &chunk.file_id, "Chunk offset overflow"),
                    None,
                );
            };
            if offset != incoming.received_bytes {
                if let Some(removed) = files.remove(&chunk.file_id) {
                    let _ = fs::remove_file(removed.path).await;
                }
                registry.cancel(&chunk.file_id);
                return (
                    file_error("FILE_CHUNK_ACK", &chunk.file_id, "Out-of-order file chunk"),
                    None,
                );
            }
            if incoming.file.write_all(&bytes).await.is_err() {
                if let Some(removed) = files.remove(&chunk.file_id) {
                    let _ = fs::remove_file(removed.path).await;
                }
                registry.cancel(&chunk.file_id);
                return (
                    file_error("FILE_CHUNK_ACK", &chunk.file_id, "Disk write error"),
                    None,
                );
            }
            let received = match registry.accept_chunk(&chunk.file_id, offset, bytes.len()) {
                Ok(received) => received,
                Err(error) => {
                    if let Some(removed) = files.remove(&chunk.file_id) {
                        let _ = fs::remove_file(removed.path).await;
                    }
                    return (file_error("FILE_CHUNK_ACK", &chunk.file_id, error), None);
                }
            };
            incoming.received_bytes = received;
            (
                json!({
                    "action": "FILE_CHUNK_ACK",
                    "fileId": chunk.file_id,
                    "chunkIndex": chunk.chunk_index,
                    "status": "SUCCESS",
                    "receivedBytes": received
                }),
                None,
            )
        }
        "FILE_END" => {
            let end: FileEnd = match serde_json::from_str(text) {
                Ok(end) => end,
                Err(error) => return (file_error("FILE_END_ACK", "", error), None),
            };
            let completed = match registry.finish(&end.file_id) {
                Ok(completed) => completed,
                Err(error) => {
                    if let Some(incoming) = files.remove(&end.file_id) {
                        let _ = fs::remove_file(incoming.path).await;
                    }
                    return (file_error("FILE_END_ACK", &end.file_id, error), None);
                }
            };
            let Some(mut incoming) = files.remove(&end.file_id) else {
                return (file_error("FILE_END_ACK", &end.file_id, "Unknown transfer"), None);
            };
            if incoming.file.flush().await.is_err() {
                let _ = fs::remove_file(incoming.path).await;
                return (
                    file_error("FILE_END_ACK", &end.file_id, "Unable to finalize file"),
                    None,
                );
            }
            drop(incoming.file);
            let final_path = match finalize_unique_file(
                &incoming.path,
                download_folder,
                &incoming.requested_name,
            )
            .await
            {
                Ok(path) => path,
                Err(_) => {
                    let _ = fs::remove_file(incoming.path).await;
                    return (
                        file_error("FILE_END_ACK", &end.file_id, "Unable to finalize file"),
                        None,
                    );
                }
            };
            let final_name = final_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("file")
                .to_owned();
            (
                json!({
                    "action": "FILE_END_ACK",
                    "fileId": end.file_id,
                    "status": "SUCCESS",
                    "receivedBytes": completed.received_bytes,
                    "fileName": final_name
                }),
                Some((final_name, final_path, completed.received_bytes)),
            )
        }
        "FILE_CANCEL" => {
            let end: FileEnd = match serde_json::from_str(text) {
                Ok(end) => end,
                Err(error) => return (file_error("FILE_CANCEL_ACK", "", error), None),
            };
            registry.cancel(&end.file_id);
            if let Some(incoming) = files.remove(&end.file_id) {
                let _ = fs::remove_file(incoming.path).await;
            }
            (
                json!({"action": "FILE_CANCEL_ACK", "fileId": end.file_id, "status": "SUCCESS"}),
                None,
            )
        }
        _ => unreachable!(),
    }
}

async fn create_temporary_file(folder: &Path, file_id: &str) -> std::io::Result<(PathBuf, File)> {
    for suffix in 0..1000_u16 {
        let path = folder.join(format!(".aether-{file_id}-{suffix}.part"));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "no collision-free temporary file name is available",
    ))
}

async fn finalize_unique_file(
    temporary_path: &Path,
    folder: &Path,
    file_name: &str,
) -> std::io::Result<PathBuf> {
    let clean_name = file_name.trim_end_matches(|c: char| c == ' ' || c == '.');
    let effective_name = if clean_name.is_empty() { "file" } else { clean_name };
    let (stem, extension) = match effective_name.rfind('.') {
        Some(dot_idx) if dot_idx > 0 => (&effective_name[..dot_idx], Some(&effective_name[dot_idx + 1..])),
        _ => (effective_name, None),
    };
    for index in 0..1000_u16 {
        let candidate_name = if index == 0 {
            effective_name.to_owned()
        } else if let Some(ext) = extension {
            format!("{stem} ({index}).{ext}")
        } else {
            format!("{effective_name} ({index})")
        };
        let target = folder.join(&candidate_name);
        if OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .await
            .is_ok()
        {
            if let Err(error) = fs::rename(temporary_path, &target).await {
                let _ = fs::remove_file(&target).await;
                return Err(error);
            }
            return Ok(target);
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "no collision-free destination file name is available",
    ))
}

fn sanitize_file_name(raw_name: &str) -> String {
    let base_name = Path::new(raw_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("downloaded_file");
    let cleaned: String = base_name
        .chars()
        .map(|character| {
            if matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || character.is_control()
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim_end_matches(['.', ' ']).trim();
    let fallback = if trimmed.is_empty() {
        "downloaded_file"
    } else {
        trimmed
    };
    let stem = fallback
        .split('.')
        .next()
        .unwrap_or(fallback)
        .to_ascii_uppercase();
    let safe = if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        format!("_{fallback}")
    } else {
        fallback.to_owned()
    };
    safe.chars().take(180).collect()
}

fn file_error(action: &str, file_id: &str, error: impl ToString) -> Value {
    json!({
        "action": action,
        "fileId": file_id,
        "status": "ERROR",
        "error": error.to_string()
    })
}

async fn authenticate(
    socket: &mut WebSocket,
    peer: SocketAddr,
    state: &SharedState,
    request: AuthRequest,
    streaming_flag: Arc<AtomicBool>,
    control_tx: mpsc::UnboundedSender<ClientControl>,
) -> Option<(String, ConnectedClientEntry)> {
    let now_inst = Instant::now();
    let now_ms = now_millis();

    let existing_token = if !request.session_token.is_empty() {
        let mut tokens = state.trusted_tokens.lock().ok()?;
        tokens.retain(|_, record| record.expires_at_ms > now_ms);
        tokens.get(&request.session_token).cloned()
    } else {
        None
    };

    let token_valid = existing_token.is_some();
    let trimmed_pin = request.pin.trim();
    let clean_request_pin: String = trimmed_pin.chars().filter(|c| c.is_ascii_digit()).collect();
    let full_pin = (state.config.pin)();
    let clean_full_pin: String = full_pin.chars().filter(|c| c.is_ascii_digit()).collect();

    let pin_matches = if trimmed_pin.is_empty() || clean_request_pin.is_empty() {
        false
    } else if let Some(ref validator) = state.config.pin_validator {
        validator(&clean_request_pin)
    } else if constant_time_text_eq(&clean_request_pin, &clean_full_pin) {
        true
    } else if clean_full_pin.len() >= 6 && clean_request_pin.len() == 6 {
        constant_time_text_eq(&clean_request_pin, &clean_full_pin[clean_full_pin.len() - 6..])
    } else {
        false
    };

    if !token_valid && trimmed_pin.is_empty() {
        let _ = send_json(
            socket,
            json!({
                "status": "AUTH_FAILED",
                "error": if request.session_token.is_empty() {
                    "Empty PIN provided"
                } else {
                    "Session token expired or revoked"
                },
                "remainingAttempts": 3
            }),
        )
        .await;
        return None;
    }

    let decision = if token_valid {
        state
            .limiter
            .lock()
            .ok()?
            .record(&peer.ip().to_string(), true, now_inst);
        AuthDecision::Allowed
    } else {
        state
            .limiter
            .lock()
            .ok()?
            .record(&peer.ip().to_string(), pin_matches, now_inst)
    };

    match decision {
        AuthDecision::Rejected { remaining_attempts } => {
            let _ = send_json(
                socket,
                json!({
                    "status": "AUTH_FAILED",
                    "error": "Incorrect PIN or pairing key",
                    "remainingAttempts": remaining_attempts
                }),
            )
            .await;
            None
        }
        AuthDecision::Blocked { retry_after } => {
            let _ = send_json(
                socket,
                json!({
                    "status": "AUTH_BLOCKED",
                    "error": "Brute force blocked. Too many attempts.",
                    "cooldown": retry_after.as_secs()
                }),
            )
            .await;
            None
        }
        AuthDecision::Allowed => {
            let mut ran_interactive_prompt = false;
            let approval = if !existing_token.as_ref().is_some_and(|t| t.trusted) {
                ran_interactive_prompt = true;
                let request_id = format!("rust-approval-{}", generate_token());
                if send_json(
                    socket,
                    json!({
                        "status": "AUTH_PENDING",
                        "requestId": request_id
                    }),
                )
                .await
                .is_err()
                {
                    return None;
                }
                let gate = state.config.approval_gate.clone();
                let req = PairingRequest {
                    request_id: request_id.clone(),
                    client_ip: peer.ip().to_string(),
                    device_model: request.device_model.chars().take(80).collect(),
                };
                let approve_fut = gate.approve(req);
                tokio::pin!(approve_fut);
                let mut keepalive_tick = tokio::time::interval(Duration::from_secs(10));
                keepalive_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                keepalive_tick.tick().await;
                loop {
                    tokio::select! {
                        decision = &mut approve_fut => break decision,
                        _ = keepalive_tick.tick() => {
                            if socket.send(WsMessage::Ping(Vec::new().into())).await.is_err() {
                                gate.cancel(&request_id).await;
                                return None;
                            }
                        }
                        ws_ev = socket.next() => {
                            match ws_ev {
                                None | Some(Ok(WsMessage::Close(_))) | Some(Err(_)) => {
                                    gate.cancel(&request_id).await;
                                    return None;
                                }
                                Some(Ok(_)) => continue,
                            }
                        }
                    }
                }
            } else {
                Approval {
                    approved: true,
                    trusted: true,
                }
            };

            if ran_interactive_prompt && let Some(ref sink) = state.config.events {
                sink.on_pairing_decision(approval.approved);
            }

            if !approval.approved {
                if let Ok(mut limiter) = state.limiter.lock() {
                    limiter.record(&peer.ip().to_string(), false, Instant::now());
                }
                let _ = send_json(
                    socket,
                    json!({
                        "status": "AUTH_REJECTED",
                        "error": "Connection rejected on PC"
                    }),
                )
                .await;
                return None;
            }

            let device_model: String = request.device_model.chars().take(80).collect();
            let device_name = if device_model.trim().is_empty() {
                "Aether Mobile Client".to_owned()
            } else {
                device_model.clone()
            };
            let ip_str = peer.ip().to_string();
            let now_ms = now_millis();

            let session_token = if token_valid {
                request.session_token
            } else {
                generate_token()
            };

            let updated_tokens_list = if let Ok(mut tokens) = state.trusted_tokens.lock() {
                let entry = tokens.entry(session_token.clone()).or_insert_with(|| TrustedTokenRecord {
                    token: session_token.clone(),
                    device_name: device_name.clone(),
                    ip_address: ip_str.clone(),
                    trusted: approval.trusted,
                    issued_at_ms: now_ms,
                    last_used_at_ms: now_ms,
                    expires_at_ms: now_ms + SESSION_TOKEN_TTL_MS,
                });
                entry.last_used_at_ms = now_ms;
                entry.ip_address = ip_str.clone();
                if !device_model.trim().is_empty() {
                    entry.device_name = device_name;
                }
                if approval.trusted {
                    entry.trusted = true;
                }
                tokens.retain(|_, r| r.expires_at_ms > now_ms);
                tokens.values().filter(|r| r.trusted).cloned().collect::<Vec<_>>()
            } else {
                Vec::new()
            };

            if let Some(ref sink) = state.config.events {
                sink.on_tokens_changed(&updated_tokens_list);
            }

            let connected_clients = state.clients.lock().map(|g| g.len() + 1).unwrap_or(1);
            let mut auth_ok = json!({
                "status": "AUTH_OK",
                "sessionToken": session_token,
                "capabilities": RUST_HOST_CAPABILITIES,
                "trusted": approval.trusted || existing_token.as_ref().is_some_and(|t| t.trusted),
                "connectedClients": connected_clients,
                "host": state.config.hostname,
                "mac": state.config.mac,
                "platform": if cfg!(target_os = "windows") { "win32" } else { std::env::consts::OS },
                "protocolVersion": PROTOCOL_VERSION
            });
            if let Some(ref fp) = state.config.tls_fingerprint {
                auth_ok["tlsFingerprint"] = json!(fp);
            }

            if send_json(socket, auth_ok).await.is_err() {
                return None;
            }

            let id = state.next_client_id.fetch_add(1, Ordering::AcqRel);
            Some((
                session_token.clone(),
                ConnectedClientEntry {
                    id,
                    ip_address: ip_str,
                    device_model: if device_model.is_empty() {
                        "Aether Mobile Client".to_owned()
                    } else {
                        device_model
                    },
                    session_token,
                    capabilities: request.capabilities,
                    streaming: streaming_flag,
                    control_tx,
                },
            ))
        }
    }
}

pub fn generate_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn generate_pairing_secret() -> String {
    let value = rand::rng().random_range(0..1_000_000_u32);
    format!("{value:06}")
}

pub fn token_public_id(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut hex = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    hex
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_millis_value() -> Value {
    Value::from(now_millis())
}

fn origin_allowed(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get("origin").and_then(|value| value.to_str().ok()) else {
        return true;
    };
    let lower = origin.to_ascii_lowercase();
    let uri = match lower.parse::<Uri>() {
        Ok(uri) if matches!(uri.scheme_str(), Some("http" | "https")) => uri,
        _ => return false,
    };
    let host = uri.host().unwrap_or_default();
    if host == "localhost" {
        return true;
    }
    let host = host.trim_matches(['[', ']']);
    let Ok(address) = host.parse::<IpAddr>() else {
        return false;
    };
    address.is_loopback()
        || match address {
            IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
            IpAddr::V6(v6) => {
                let seg = v6.segments()[0];
                (seg & 0xfe00) == 0xfc00 || (seg & 0xffc0) == 0xfe80
            }
        }
}

pub fn constant_time_text_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut difference = left.len() ^ right.len();
    let length = left.len().max(right.len());
    for index in 0..length {
        difference |= usize::from(
            left.get(index).copied().unwrap_or_default()
                ^ right.get(index).copied().unwrap_or_default(),
        );
    }
    difference == 0
}

async fn send_json(socket: &mut WebSocket, value: impl Serialize) -> Result<(), axum::Error> {
    let text = serde_json::to_string(&value).expect("serializable server response");
    socket.send(WsMessage::Text(text.into())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    struct AllowPairing;

    #[derive(Default)]
    struct MemoryClipboard(std::sync::Mutex<String>);

    #[derive(Default)]
    struct RecordingMedia(std::sync::Mutex<Vec<(String, Option<u8>)>>);

    #[async_trait]
    impl ClipboardProvider for MemoryClipboard {
        async fn read_text(&self) -> Result<String, String> {
            self.0
                .lock()
                .map(|text| text.clone())
                .map_err(|_| "clipboard lock failed".to_owned())
        }

        async fn write_text(&self, text: String) -> Result<(), String> {
            *self
                .0
                .lock()
                .map_err(|_| "clipboard lock failed".to_owned())? = text;
            Ok(())
        }
    }

    #[async_trait]
    impl MediaProvider for RecordingMedia {
        async fn control(&self, command: String, value: Option<u8>) -> Result<Value, String> {
            self.0
                .lock()
                .map_err(|_| "media lock failed".to_owned())?
                .push((command, value));
            Ok(json!({"ok": true}))
        }
    }

    #[tokio::test]
    async fn media_action_is_dispatched_to_provider() {
        let media = RecordingMedia::default();
        let fields = BTreeMap::from([
            ("command".to_owned(), json!("VOL_SET")),
            ("value".to_owned(), json!(42)),
        ]);
        let response = handle_media_action(&fields, &media).await;

        assert_eq!(response["status"], "MEDIA_EXECUTED");
        assert_eq!(
            *media.0.lock().unwrap(),
            vec![("VOL_SET".to_owned(), Some(42))]
        );
    }

    #[async_trait]
    impl ApprovalGate for AllowPairing {
        async fn approve(&self, _request: PairingRequest) -> Approval {
            Approval {
                approved: true,
                trusted: true,
            }
        }
    }

    fn config(port: u16) -> ServerConfig {
        ServerConfig {
            pin: Arc::new(|| "123456".to_owned()),
            pin_validator: None,
            hostname: "test-host".to_owned(),
            mac: "AA:BB:CC:DD:EE:FF".to_owned(),
            port,
            download_folder: std::env::temp_dir().join("aether-host-server-tests"),
            dynamic_download_folder: None,
            approval_gate: Arc::new(AllowPairing),
            telemetry: Arc::new(EmptyTelemetry),
            clipboard: Arc::new(NoClipboard),
            media: Arc::new(NoMedia),
            tls_config: None,
            tls_fingerprint: None,
            persisted_tokens: Vec::new(),
            events: None,
            deck_service: None,
            audio_hub: None,
            outbound_tx: None,
            require_tls_for_lan: false,
        }
    }

    async fn start() -> RunningServer {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        spawn(listener, config(port)).await.unwrap()
    }

    #[tokio::test]
    async fn health_endpoint_matches_existing_contract() {
        let server = start().await;
        let response = reqwest_without_dependency(server.address, "/health").await;
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("\"protocolVersion\":\"2.0\""));
        assert!(
            response
                .to_ascii_lowercase()
                .contains("x-content-type-options: nosniff")
        );
        assert!(!response.contains("AA:BB:CC:DD:EE:FF"));
        server.shutdown().await.unwrap();
    }

    #[test]
    fn origin_policy_accepts_numeric_lan_hosts_and_rejects_lookalike_domains() {
        fn headers(origin: &'static str) -> HeaderMap {
            let mut headers = HeaderMap::new();
            headers.insert("origin", origin.parse().unwrap());
            headers
        }
        assert!(origin_allowed(&headers("http://192.168.1.20:3000")));
        assert!(origin_allowed(&headers("http://10.0.0.5")));
        assert!(origin_allowed(&headers("https://[::1]:8080")));
        assert!(origin_allowed(&headers("https://[fe80::1]:8080")));
        assert!(!origin_allowed(&headers("file://local-page")));
        assert!(!origin_allowed(&headers("https://192.168.evil.example")));
        assert!(!origin_allowed(&headers("https://10.attacker.example")));
        assert!(!origin_allowed(&headers("https://example.com")));
    }

    #[test]
    fn pin_comparison_checks_value_and_length() {
        assert!(constant_time_text_eq("123456789", "123456789"));
        assert!(!constant_time_text_eq("123456780", "123456789"));
        assert!(!constant_time_text_eq("123", "123456789"));
    }

    #[tokio::test]
    async fn websocket_requires_auth_then_supports_ping() {
        let server = start().await;
        let url = format!("ws://{}/ws", server.address);
        let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();

        socket
            .send(Message::Text(r#"{"action":"PING"}"#.into()))
            .await
            .unwrap();
        let required = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&required).unwrap()["status"],
            "AUTH_REQUIRED"
        );

        socket
            .send(Message::Text(
                r#"{"action":"AUTH","pin":"123456","deviceModel":"Pixel"}"#.into(),
            ))
            .await
            .unwrap();
        let pending = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&pending).unwrap()["status"],
            "AUTH_PENDING"
        );
        let auth = socket.next().await.unwrap().unwrap().into_text().unwrap();
        let auth: Value = serde_json::from_str(&auth).unwrap();
        assert_eq!(auth["status"], "AUTH_OK");
        assert_eq!(auth["protocolVersion"], "2.0");
        assert!(auth["sessionToken"].as_str().unwrap().len() >= 40);
        assert_eq!(server.connected_clients_count(), 1);

        server
            .broadcast(json!({"action": "FILE_CANCEL", "fileId": "tauri-test"}))
            .unwrap();
        let outbound = socket.next().await.unwrap().unwrap().into_text().unwrap();
        let outbound: Value = serde_json::from_str(&outbound).unwrap();
        assert_eq!(outbound["action"], "FILE_CANCEL");
        assert_eq!(outbound["fileId"], "tauri-test");

        socket
            .send(Message::Text(r#"{"action":"PING","timestamp":42}"#.into()))
            .await
            .unwrap();
        let pong = socket.next().await.unwrap().unwrap().into_text().unwrap();
        let pong: Value = serde_json::from_str(&pong).unwrap();
        assert_eq!(pong["action"], "PONG");
        assert_eq!(pong["timestamp"], 42);
        drop(socket);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(server.connected_clients_count(), 0);
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn stalled_tcp_connection_does_not_block_concurrent_websocket_clients() {
        let server = start().await;
        let _stalled = tokio::net::TcpStream::connect(server.address).await.unwrap();
        let url = format!("ws://{}/ws", server.address);
        let (mut socket, _) = tokio::time::timeout(
            Duration::from_secs(2),
            tokio_tungstenite::connect_async(url),
        )
        .await
        .expect("accept loop must not stall on an idle peer")
        .unwrap();
        socket.send(Message::Text(r#"{"action":"PING"}"#.into())).await.unwrap();
        let reply = socket.next().await.unwrap().unwrap().into_text().unwrap();
        assert_eq!(serde_json::from_str::<Value>(&reply).unwrap()["status"], "AUTH_REQUIRED");
        drop(socket);
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn blocks_fourth_auth_attempt_during_cooldown() {
        let server = start().await;
        let url = format!("ws://{}/ws", server.address);
        let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
        for expected in ["AUTH_FAILED", "AUTH_FAILED", "AUTH_BLOCKED", "AUTH_BLOCKED"] {
            socket
                .send(Message::Text(r#"{"action":"AUTH","pin":"bad"}"#.into()))
                .await
                .unwrap();
            let reply = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&reply).unwrap()["status"],
                expected
            );
        }
        drop(socket);
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn clipboard_read_and_write_use_existing_wire_shapes() {
        let clipboard = MemoryClipboard::default();
        let write = serde_json::from_value::<aether_protocol::Message>(json!({
            "action": "CLIPBOARD",
            "command": "SET_CLIPBOARD",
            "text": "hello"
        }))
        .unwrap();
        let response = handle_clipboard_action(&write.fields, &clipboard).await;
        assert_eq!(response["action"], "CLIPBOARD_WRITE_ACK");
        assert_eq!(response["status"], "CLIPBOARD_WRITTEN");

        let read = serde_json::from_value::<aether_protocol::Message>(json!({
            "action": "CLIPBOARD",
            "command": "GET_CLIPBOARD"
        }))
        .unwrap();
        let response = handle_clipboard_action(&read.fields, &clipboard).await;
        assert_eq!(response["action"], "CLIPBOARD_TEXT");
        assert_eq!(response["text"], "hello");
    }

    #[tokio::test]
    async fn receives_file_in_order_and_saves_exact_bytes() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("hello.txt"), b"existing")
            .await
            .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut server_config = config(port);
        server_config.download_folder = directory.path().to_owned();
        let server = spawn(listener, server_config).await.unwrap();
        let (mut socket, _) =
            tokio_tungstenite::connect_async(format!("ws://{}/ws", server.address))
                .await
                .unwrap();
        socket
            .send(Message::Text(
                r#"{"action":"AUTH","pin":"123456","deviceModel":"Pixel"}"#.into(),
            ))
            .await
            .unwrap();
        for expected in ["AUTH_PENDING", "AUTH_OK"] {
            let reply = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&reply).unwrap()["status"],
                expected
            );
        }

        let messages = [
            r#"{"action":"FILE_START","fileId":"transfer-1","fileName":"hello.txt","fileSize":5,"chunkSize":5}"#,
            r#"{"action":"FILE_CHUNK","fileId":"transfer-1","chunkIndex":0,"offset":0,"data":"aGVsbG8="}"#,
            r#"{"action":"FILE_END","fileId":"transfer-1"}"#,
        ];
        let expected = ["FILE_START_ACK", "FILE_CHUNK_ACK", "FILE_END_ACK"];
        for (message, expected_action) in messages.into_iter().zip(expected) {
            socket.send(Message::Text(message.into())).await.unwrap();
            let reply = socket.next().await.unwrap().unwrap().into_text().unwrap();
            let reply: Value = serde_json::from_str(&reply).unwrap();
            assert_eq!(reply["action"], expected_action);
            assert_eq!(reply["status"], "SUCCESS");
        }
        assert_eq!(
            fs::read(directory.path().join("hello.txt")).await.unwrap(),
            b"existing"
        );
        assert_eq!(
            fs::read(directory.path().join("hello (1).txt"))
                .await
                .unwrap(),
            b"hello"
        );
        drop(socket);
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn handles_remote_mouse_and_key_actions() {
        let server = start().await;
        let url = format!("ws://{}/ws", server.address);
        let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();

        socket
            .send(Message::Text(
                r#"{"action":"AUTH","pin":"123456","deviceModel":"Pixel"}"#.into(),
            ))
            .await
            .unwrap();
        let _ = socket.next().await;
        let _ = socket.next().await;

        socket.send(Message::Text(r#"{"action":"MOUSE_MOVE","dx":1,"dy":1}"#.into())).await.unwrap();
        let reply: Value = serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(reply["action"], "MOUSE_MOVE_ACK");
        assert_eq!(reply["status"], "SUCCESS");

        socket.send(Message::Text(r#"{"action":"MOUSE_CLICK","text":"left"}"#.into())).await.unwrap();
        let reply: Value = serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(reply["action"], "MOUSE_CLICK_ACK");
        assert_eq!(reply["status"], "SUCCESS");

        socket.send(Message::Text(r#"{"action":"MOUSE_SCROLL","dy":1}"#.into())).await.unwrap();
        let reply: Value = serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(reply["action"], "MOUSE_SCROLL_ACK");
        assert_eq!(reply["status"], "SUCCESS");

        socket.send(Message::Text(r#"{"action":"KEY_PRESS","text":"ENTER"}"#.into())).await.unwrap();
        let reply: Value = serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(reply["action"], "KEY_PRESS_ACK");
        assert_eq!(reply["status"], "SUCCESS");

        drop(socket);
        server.shutdown().await.unwrap();
    }

    #[test]
    fn cert_validity_checker_accepts_fresh_and_legacy_certs_and_rejects_expired() {
        let (_, _, fresh_der, _) =
            generate_self_signed_cert_with_der(&["192.168.1.5".to_owned(), "localhost".to_owned()])
                .unwrap();
        assert!(cert_is_currently_valid(&fresh_der, 30 * 86_400));

        // Legacy rcgen default (1975-01-01 to 4096-01-01 GeneralizedTime) must also stay accepted
        let legacy_params = rcgen::CertificateParams::default();
        let legacy_key = rcgen::KeyPair::generate().unwrap();
        let legacy_cert = legacy_params.self_signed(&legacy_key).unwrap();
        assert!(cert_is_currently_valid(legacy_cert.der(), 30 * 86_400));

        // Expired cert must be rejected
        let mut expired_params = rcgen::CertificateParams::default();
        expired_params.not_before = rcgen::date_time_ymd(2020, 1, 1);
        expired_params.not_after = rcgen::date_time_ymd(2021, 1, 1);
        let expired_key = rcgen::KeyPair::generate().unwrap();
        let expired_cert = expired_params.self_signed(&expired_key).unwrap();
        assert!(!cert_is_currently_valid(expired_cert.der(), 30 * 86_400));

        assert!(!cert_is_currently_valid(b"not-a-cert", 0));
    }

    #[tokio::test]
    async fn account_hello_returns_clear_auth_rejected() {
        let server = start().await;
        let url = format!("ws://{}/ws", server.address);
        let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();

        socket
            .send(Message::Text(
                r#"{"action":"ACCOUNT_HELLO","accountId":"acc1","deviceId":"dev1"}"#.into(),
            ))
            .await
            .unwrap();
        let reply: Value = serde_json::from_str(
            &socket.next().await.unwrap().unwrap().into_text().unwrap(),
        )
        .unwrap();
        assert_eq!(reply["status"], "AUTH_REJECTED");

        drop(socket);
        server.shutdown().await.unwrap();
    }

    async fn reqwest_without_dependency(address: SocketAddr, path: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        stream
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
        let mut output = String::new();
        stream.read_to_string(&mut output).await.unwrap();
        output
    }
}
