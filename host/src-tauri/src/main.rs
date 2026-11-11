#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod discovery;
mod storage;
mod win_system;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aether_host_server::deck::{DeckExecutor, DeckService};
use aether_host_server::{
    Approval, ApprovalGate, ClipboardProvider, ConnectedClientSummary, HostEventSink,
    MediaProvider, PairingRequest, RunningServer, ServerConfig, TelemetryProvider,
    TrustedTokenRecord, constant_time_text_eq, generate_pairing_secret, token_public_id,
    win_input,
};
use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tokio::sync::{broadcast, oneshot};

use discovery::DiscoveryIdentity;
use storage::WakeTargetRecord;

const HOST_PORT: u16 = 8080;

type PendingApprovals = Arc<Mutex<HashMap<String, oneshot::Sender<Approval>>>>;

struct AppState {
    data_dir: PathBuf,
    autostart: AtomicBool,
    minimize_to_tray: AtomicBool,
    clipboard_sharing: AtomicBool,
    download_folder: Arc<RwLock<PathBuf>>,
    pending_approvals: PendingApprovals,
    server: Mutex<Option<RunningServer>>,
    identity: HostIdentity,
    discovery_shutdown: Mutex<Option<oneshot::Sender<()>>>,
    outgoing_files: Mutex<HashMap<String, OutgoingFile>>,
    outgoing_ack_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<Result<(), String>>>>>,
    next_transfer_id: AtomicU64,
    tls_fingerprint: Mutex<Option<String>>,
    server_error: Mutex<Option<String>>,
    deck_service: Mutex<Option<Arc<DeckService>>>,
    wake_targets: Mutex<Vec<WakeTargetRecord>>,
    last_clipboard_hash: Arc<Mutex<String>>,
}

struct OutgoingFile {
    name: String,
    size: u64,
    sent: u64,
}

#[derive(Clone)]
struct HostIdentity {
    hostname: String,
    ip_address: Arc<RwLock<String>>,
    endpoints: Arc<RwLock<Vec<win_system::NetworkEndpointInfo>>>,
    mac_address: String,
    hardware_pin: Arc<RwLock<String>>,
}

impl AppState {
    fn new(
        data_dir: PathBuf,
        identity: HostIdentity,
        pending_approvals: PendingApprovals,
        settings: storage::HostSettings,
        wake_targets: Vec<WakeTargetRecord>,
    ) -> Self {
        Self {
            data_dir,
            autostart: AtomicBool::new(win_system::read_autostart_enabled()),
            minimize_to_tray: AtomicBool::new(settings.minimize_to_tray),
            clipboard_sharing: AtomicBool::new(settings.clipboard_sharing),
            download_folder: Arc::new(RwLock::new(settings.download_folder)),
            pending_approvals,
            server: Mutex::new(None),
            identity,
            discovery_shutdown: Mutex::new(None),
            outgoing_files: Mutex::new(HashMap::new()),
            outgoing_ack_waiters: Arc::new(Mutex::new(HashMap::new())),
            next_transfer_id: AtomicU64::new(1),
            tls_fingerprint: Mutex::new(None),
            server_error: Mutex::new(None),
            deck_service: Mutex::new(None),
            wake_targets: Mutex::new(wake_targets),
            last_clipboard_hash: Arc::new(Mutex::new(String::new())),
        }
    }

    fn persist_settings(&self) {
        let dl = self
            .download_folder
            .read()
            .map(|p| p.clone())
            .unwrap_or_else(|_| storage::HostSettings::default().download_folder);
        let settings = storage::HostSettings {
            download_folder: dl,
            minimize_to_tray: self.minimize_to_tray.load(Ordering::Relaxed),
            clipboard_sharing: self.clipboard_sharing.load(Ordering::Relaxed),
        };
        storage::save_settings(&self.data_dir, &settings);
    }
}

struct TauriApprovalGate {
    app: AppHandle,
    pending: PendingApprovals,
}

struct WindowsClipboard;
struct WindowsMedia;

struct TauriDeckExecutor {
    app: AppHandle,
    media: Arc<WindowsMedia>,
}

#[async_trait]
impl DeckExecutor for TauriDeckExecutor {
    async fn execute_media(&self, command: &str, value: Option<u8>) -> Result<Value, String> {
        self.media.control(command.to_owned(), value).await
    }

    async fn set_stream_enabled(&self, enabled: bool) -> Result<(), String> {
        let state = self.app.state::<AppState>();
        let server_guard = state
            .server
            .lock()
            .map_err(|_| "server lock unavailable".to_owned())?;
        if let Some(ref srv) = *server_guard {
            srv.set_clients_stream_enabled(enabled);
        }
        Ok(())
    }
}

struct TauriHostSink {
    app: AppHandle,
    data_dir: PathBuf,
    last_clipboard_hash: Arc<Mutex<String>>,
    outgoing_ack_waiters: Arc<Mutex<HashMap<String, oneshot::Sender<Result<(), String>>>>>,
}

impl HostEventSink for TauriHostSink {
    fn on_client_authenticated(&self, client: &ConnectedClientSummary) {
        let _ = self.app.emit(
            "client-authenticated",
            json!({
                "ip": client.ip_address,
                "ipAddress": client.ip_address,
                "deviceModel": client.device_model,
                "capabilities": client.capabilities
            }),
        );
    }

    fn on_client_disconnected(&self, ip: &str, remaining: usize) {
        let _ = self.app.emit(
            "client-disconnected",
            json!({ "ip": ip, "remaining": remaining }),
        );
    }

    fn on_tokens_changed(&self, tokens: &[TrustedTokenRecord]) {
        storage::save_trusted_tokens(&self.data_dir, tokens);
        let ui_tokens = format_tokens_for_ui(tokens);
        let _ = self.app.emit("tokens-updated", ui_tokens);
    }

    fn on_pairing_decision(&self, _approved: bool) {
        let next_secret = generate_pairing_secret();
        let st = self.app.state::<AppState>();
        if let Ok(mut g) = st.identity.hardware_pin.write() {
            *g = next_secret.clone();
        }
        let primary_ip = st
            .identity
            .ip_address
            .read()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "127.0.0.1".to_owned());
        let endpoints = st
            .identity
            .endpoints
            .read()
            .map(|g| g.clone())
            .unwrap_or_default();
        let fp = st
            .tls_fingerprint
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or_default();
        let _ = self.app.emit(
            "hardware-info-updated",
            json!({
                "hardwarePin": next_secret,
                "pairingCode": pairing_code_for_ip(&primary_ip, &next_secret),
                "ipAddress": primary_ip,
                "networkEndpoints": endpoints,
                "tlsFingerprint": fp
            }),
        );
    }

    fn on_file_received(&self, file_name: &str, file_path: &Path, size: u64) {
        let path_str = file_path.to_string_lossy().into_owned();
        let _ = self.app.emit(
            "file-received",
            json!({
                "name": file_name,
                "fileName": file_name,
                "path": path_str,
                "filePath": path_str,
                "size": size,
                "fileSize": size,
                "timestamp": aether_host_server::now_millis()
            }),
        );
    }

    fn on_outgoing_file_ack(&self, action: &str, fields: &BTreeMap<String, Value>) {
        let Some(file_id) = fields.get("fileId").and_then(Value::as_str) else {
            return;
        };
        let key = format!("{action}:{file_id}");
        let tx = self
            .outgoing_ack_waiters
            .lock()
            .ok()
            .and_then(|mut g| g.remove(&key));
        let Some(tx) = tx else {
            return;
        };
        let status = fields
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("");
        if status.eq_ignore_ascii_case("SUCCESS") {
            let _ = tx.send(Ok(()));
        } else {
            let err = fields
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Mobile device rejected file transfer")
                .to_owned();
            let _ = tx.send(Err(err));
        }
    }

    fn on_clipboard_written_by_remote(&self, text: &str) {
        if let Ok(mut guard) = self.last_clipboard_hash.lock() {
            *guard = clipboard_hash(text);
        }
    }

    fn on_toast(&self, title: &str, message: &str) {
        let _ = self
            .app
            .emit("toast-received", json!({ "title": title, "message": message }));
    }

    fn on_stream_frame_preview(&self, jpeg_base64: &str) {
        let _ = self
            .app
            .emit("screen-preview-frame", json!({ "image": jpeg_base64 }));
    }
}

struct SystemTelemetry {
    previous_cpu: Arc<Mutex<Option<CpuTimes>>>,
    previous_net: Arc<Mutex<Option<(u64, u64, std::time::Instant)>>>,
    hostname: String,
}

#[derive(Clone, Copy)]
struct CpuTimes {
    idle: u64,
    kernel: u64,
    user: u64,
}

impl SystemTelemetry {
    async fn detailed_snapshot(
        &self,
        connected_clients: usize,
        streaming: bool,
        active_client: Option<ConnectedClientSummary>,
    ) -> Value {
        let previous_cpu = self.previous_cpu.clone();
        let previous_net = self.previous_net.clone();
        let hostname = self.hostname.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let (total_bytes, used_bytes) = windows_memory_bytes().unwrap_or((0.0, 0.0));
            let ram_percent = if total_bytes > 0.0 {
                used_bytes * 100.0 / total_bytes
            } else {
                0.0
            };
            let cpu = windows_cpu_percent(&previous_cpu).unwrap_or(0.0);
            let (net_down, net_up) = compute_net_rates_mbps(&previous_net);
            let (vol, muted) = win_system::get_system_audio_state();
            let (track, artist, is_playing) = win_system::read_current_media_session();
            let monitors = aether_host_server::monitors_count();

            let mut payload = json!({
                "cpu": (cpu * 10.0).round() / 10.0,
                "ram": (ram_percent * 10.0).round() / 10.0,
                "ramUsedGb": ((used_bytes / 1_073_741_824.0) * 10.0).round() / 10.0,
                "ramTotalGb": ((total_bytes / 1_073_741_824.0) * 10.0).round() / 10.0,
                "net_upload": net_up,
                "net_download": net_down,
                "hostname": hostname,
                "uptime": windows_uptime_seconds(),
                "monitorsCount": monitors,
                "track": track,
                "artist": artist,
                "isPlaying": is_playing,
                "isScreenStreaming": streaming,
                "volume": vol,
                "isMuted": muted,
                "connectedClients": connected_clients
            });
            if let Some(client) = active_client {
                payload["activeClient"] = json!(client);
            }
            payload
        })
        .await
        .unwrap_or_else(|_| {
            json!({
                "hostname": self.hostname,
                "connectedClients": connected_clients
            })
        })
    }
}

#[async_trait]
impl TelemetryProvider for SystemTelemetry {
    async fn snapshot(&self, connected_clients: usize) -> Value {
        self.detailed_snapshot(connected_clients, false, None).await
    }
}

fn compute_net_rates_mbps(
    previous: &Mutex<Option<(u64, u64, std::time::Instant)>>,
) -> (f64, f64) {
    let Some((rx, tx)) = win_system::sample_network_octets() else {
        return (0.0, 0.0);
    };
    let now = std::time::Instant::now();
    let Ok(mut guard) = previous.lock() else {
        return (0.0, 0.0);
    };
    let rates = if let Some((prev_rx, prev_tx, prev_at)) = *guard {
        let secs = now.duration_since(prev_at).as_secs_f64().max(0.1);
        let dl_mb = (rx.saturating_sub(prev_rx) as f64) / (1_048_576.0 * secs);
        let ul_mb = (tx.saturating_sub(prev_tx) as f64) / (1_048_576.0 * secs);
        ((dl_mb * 100.0).round() / 100.0, (ul_mb * 100.0).round() / 100.0)
    } else {
        (0.0, 0.0)
    };
    *guard = Some((rx, tx, now));
    rates
}

fn windows_memory_bytes() -> Option<(f64, f64)> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // Win32 requires the length field to be initialized before filling the structure.
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return None;
    }
    let total = status.ullTotalPhys as f64;
    Some((total, total - status.ullAvailPhys as f64))
}

fn windows_cpu_percent(previous: &Mutex<Option<CpuTimes>>) -> Option<f64> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::GetSystemTimes;
    let mut idle: FILETIME = unsafe { std::mem::zeroed() };
    let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
    let mut user: FILETIME = unsafe { std::mem::zeroed() };
    if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
        return None;
    }
    let current = CpuTimes {
        idle: filetime_value(idle),
        kernel: filetime_value(kernel),
        user: filetime_value(user),
    };
    let mut previous = previous.lock().ok()?;
    let percent = previous.map(|before| {
        let idle_delta = current.idle.saturating_sub(before.idle);
        let total_delta = current
            .kernel
            .saturating_sub(before.kernel)
            .saturating_add(current.user.saturating_sub(before.user));
        if total_delta == 0 {
            0.0
        } else {
            (total_delta.saturating_sub(idle_delta) as f64 * 100.0 / total_delta as f64)
                .clamp(0.0, 100.0)
        }
    });
    *previous = Some(current);
    Some(percent.unwrap_or(0.0))
}

fn filetime_value(value: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)
}

fn windows_uptime_seconds() -> u64 {
    unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() / 1000 }
}

#[async_trait]
impl ClipboardProvider for WindowsClipboard {
    async fn read_text(&self) -> Result<String, String> {
        tauri::async_runtime::spawn_blocking(clipboard_win::get_clipboard_string)
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())
    }

    async fn write_text(&self, text: String) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || clipboard_win::set_clipboard_string(&text))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())
    }
}

#[async_trait]
impl MediaProvider for WindowsMedia {
    async fn control(&self, command: String, value: Option<u8>) -> Result<Value, String> {
        tauri::async_runtime::spawn_blocking(move || win_system::execute_core_audio_media(&command, value))
            .await
            .map_err(|error| error.to_string())?
    }
}

fn present_main_window(app: &AppHandle, request_attention: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if request_attention {
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));
        }
    }
}

fn clear_window_attention(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(None);
    }
}

#[async_trait]
impl ApprovalGate for TauriApprovalGate {
    async fn approve(&self, request: PairingRequest) -> Approval {
        let request_id = request.request_id;
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(request_id.clone(), sender);
        } else {
            return Approval {
                approved: false,
                trusted: false,
            };
        }
        present_main_window(&self.app, true);
        let payload = json!({
            "requestId": request_id,
            "ip": request.client_ip,
            "deviceModel": request.device_model,
            "type": if request_id.starts_with("deck-exec") { "command" } else { "pairing" }
        });
        if self.app.emit("pairing-request", payload).is_err() {
            remove_pending(&self.pending, &request_id);
            clear_window_attention(&self.app);
            return Approval {
                approved: false,
                trusted: false,
            };
        }
        match tokio::time::timeout(Duration::from_secs(45), receiver).await {
            Ok(Ok(approval)) => {
                clear_window_attention(&self.app);
                approval
            }
            _ => {
                remove_pending(&self.pending, &request_id);
                clear_window_attention(&self.app);
                let _ = self
                    .app
                    .emit("pairing-cancel", json!({ "requestId": request_id }));
                Approval {
                    approved: false,
                    trusted: false,
                }
            }
        }
    }

    async fn cancel(&self, request_id: &str) {
        remove_pending(&self.pending, request_id);
        clear_window_attention(&self.app);
        let _ = self
            .app
            .emit("pairing-cancel", json!({ "requestId": request_id }));
    }
}

#[tauri::command]
fn ipc_send(
    channel: String,
    args: Vec<Value>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    match channel.as_str() {
        "set-autostart" => {
            let enabled = first_bool(&args);
            let prev = state.autostart.swap(enabled, Ordering::Relaxed);
            if prev != enabled || win_system::read_autostart_enabled() != enabled {
                win_system::write_autostart_enabled(enabled)?;
            }
            Ok(())
        }
        "set-minimize-to-tray" => {
            state
                .minimize_to_tray
                .store(first_bool(&args), Ordering::Relaxed);
            state.persist_settings();
            Ok(())
        }
        "pairing-response" => {
            let response = args.first().ok_or("pairing response is missing")?;
            let request_id = response
                .get("requestId")
                .and_then(Value::as_str)
                .ok_or("pairing requestId is missing")?;
            let sender = state
                .pending_approvals
                .lock()
                .map_err(|_| "pairing state is unavailable")?
                .remove(request_id)
                .ok_or("pairing request is no longer pending")?;
            let approved = response
                .get("approved")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let trusted = approved
                && response
                    .get("trusted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
            clear_window_attention(&app);
            sender
                .send(Approval { approved, trusted })
                .map_err(|_| "pairing request receiver is unavailable".to_owned())
        }
        "force-disconnect-client" => {
            let disconnected = if let Ok(server) = state.server.lock()
                && let Some(ref srv) = *server
            {
                srv.disconnect_all()
            } else {
                0
            };
            let _ = app.emit(
                "client-disconnected",
                json!({ "remaining": 0, "forcedCount": disconnected }),
            );
            Ok(())
        }
        "audio-pcm-chunk" | "audio-capture-status" | "update-p2p-connections-count" => Ok(()),
        _ => Ok(()),
    }
}

#[tauri::command]
async fn ipc_invoke(
    channel: String,
    args: Vec<Value>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    match channel.as_str() {
        "get-system-info" => {
            let discovery = win_system::detect_network_endpoints(&state.identity.hostname);
            let ip_address = discovery.primary_ip;
            let hw_pin = state
                .identity
                .hardware_pin
                .read()
                .map(|g| g.clone())
                .unwrap_or_default();
            let tls_fingerprint = state
                .tls_fingerprint
                .lock()
                .ok()
                .and_then(|fp| fp.clone())
                .unwrap_or_default();
            let server_error = state
                .server_error
                .lock()
                .ok()
                .and_then(|err| err.clone());
            let server_running = state
                .server
                .lock()
                .map(|srv| srv.is_some())
                .unwrap_or(false);
            Ok(json!({
                "ipAddress": ip_address,
                "networkEndpoints": discovery.endpoints,
                "hostname": state.identity.hostname,
                "macAddress": state.identity.mac_address,
                "hardwarePin": hw_pin,
                "pairingCode": pairing_code_for_ip(&ip_address, &hw_pin),
                "tlsFingerprint": tls_fingerprint,
                "serverError": server_error,
                "serverRunning": server_running,
                "autoStart": win_system::read_autostart_enabled(),
                "minimizeToTray": state.minimize_to_tray.load(Ordering::Relaxed),
                "osVersion": std::env::var("OS").unwrap_or_else(|_| "Windows".to_owned()),
                "protocolVersion": aether_protocol::PROTOCOL_VERSION,
                "runtime": "rust-tauri"
            }))
        }
        "get-approved-tokens" => {
            let tokens = if let Ok(server) = state.server.lock()
                && let Some(ref srv) = *server
            {
                srv.tokens_snapshot()
            } else {
                storage::load_trusted_tokens(&state.data_dir)
            };
            Ok(format_tokens_for_ui(&tokens))
        }
        "revoke-token" => {
            let token = args
                .first()
                .and_then(Value::as_str)
                .ok_or("token is missing")?;
            let removed = if let Ok(server) = state.server.lock()
                && let Some(ref srv) = *server
            {
                srv.revoke_token(token)
            } else {
                let mut stored = storage::load_trusted_tokens(&state.data_dir);
                let before = stored.len();
                stored.retain(|t| {
                    !constant_time_text_eq(&t.token, token)
                        && !constant_time_text_eq(&token_public_id(&t.token), token)
                });
                storage::save_trusted_tokens(&state.data_dir, &stored);
                let changed = stored.len() < before;
                if changed {
                    let _ = app.emit("tokens-updated", format_tokens_for_ui(&stored));
                }
                changed
            };
            Ok(json!({
                "status": if removed { "SUCCESS" } else { "NOT_FOUND" },
                "wakeRevoked": false
            }))
        }
        "get-download-folder" => {
            let path = state
                .download_folder
                .read()
                .map_err(|_| "download folder state is unavailable")?
                .clone();
            Ok(json!({ "status": "SUCCESS", "path": path.to_string_lossy() }))
        }
        "open-download-folder" => {
            let base = state
                .download_folder
                .read()
                .map_err(|_| "download folder state unavailable")?
                .clone();
            let _ = std::fs::create_dir_all(&base);
            let requested = args
                .first()
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from);
            if let Some(target) = requested
                && let (Ok(canon_base), Ok(canon_target)) = (std::fs::canonicalize(&base), std::fs::canonicalize(&target))
                && canon_target.starts_with(&canon_base)
            {
                let target_s = canon_target.to_string_lossy().into_owned();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    win_input::reveal_in_explorer(&target_s)
                })
                .await;
            } else {
                let _ = Command::new("explorer.exe").arg(&base).spawn();
            }
            Ok(json!({ "status": "SUCCESS" }))
        }
        "select-download-folder" => {
            let picked = tauri::async_runtime::spawn_blocking(|| {
                win_system::open_native_folder_dialog("Выберите папку для загрузок Aether Remote")
            })
            .await
            .map_err(|e| e.to_string())?;
            if let Some(chosen_pb) = picked {
                let _ = std::fs::create_dir_all(&chosen_pb);
                if let Ok(mut current) = state.download_folder.write() {
                    *current = chosen_pb.clone();
                }
                state.persist_settings();
                return Ok(json!({
                    "status": "SUCCESS",
                    "path": chosen_pb.to_string_lossy(),
                    "canceled": false
                }));
            }
            let current = state
                .download_folder
                .read()
                .map_err(|_| "folder lock error")?
                .clone();
            Ok(json!({
                "status": "CANCELED",
                "path": current.to_string_lossy(),
                "canceled": true
            }))
        }
        "get-clipboard-sharing" => {
            let enabled = state.clipboard_sharing.load(Ordering::Relaxed);
            let recipients = state
                .server
                .lock()
                .ok()
                .and_then(|s| s.as_ref().map(|srv| srv.capability_recipients("clipboard-history-v1")))
                .unwrap_or(0);
            Ok(json!({ "enabled": enabled, "recipients": recipients }))
        }
        "set-clipboard-sharing" => {
            let enabled = first_bool(&args);
            state.clipboard_sharing.store(enabled, Ordering::Relaxed);
            state.persist_settings();
            if enabled {
                if let Ok(Ok(current)) = tauri::async_runtime::spawn_blocking(clipboard_win::get_clipboard_string).await
                    && let Ok(mut guard) = state.last_clipboard_hash.lock()
                {
                    *guard = clipboard_hash(&current);
                }
            }
            let recipients = state
                .server
                .lock()
                .ok()
                .and_then(|s| s.as_ref().map(|srv| srv.capability_recipients("clipboard-history-v1")))
                .unwrap_or(0);
            Ok(json!({ "enabled": enabled, "recipients": recipients }))
        }
        "capture-screen" => {
            let res = tauri::async_runtime::spawn_blocking(|| {
                aether_host_server::capture_screen_jpeg_for_monitor(70, 0, Some(1280))
            })
            .await
            .map_err(|e| e.to_string())?;
            match res {
                Ok((jpeg, width, height, _)) => Ok(json!({
                    "status": "SUCCESS",
                    "image": STANDARD.encode(&jpeg),
                    "width": width,
                    "height": height
                })),
                Err(err) => Ok(json!({ "status": "ERROR", "image": "", "error": err })),
            }
        }
        "send-file-start" => {
            let input = args.first().ok_or("file metadata is missing")?;
            let size = input
                .get("size")
                .and_then(Value::as_u64)
                .ok_or("invalid file size")?;
            if size > 500 * 1024 * 1024 {
                return Err("file exceeds 500 MiB limit".to_owned());
            }
            let raw_name = input.get("name").and_then(Value::as_str).unwrap_or("file");
            let name: String = raw_name
                .chars()
                .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !c.is_control())
                .take(180)
                .collect();
            let name = if name.trim().is_empty() { "file".to_owned() } else { name };
            let transfer_id = format!(
                "tauri-{}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis(),
                state.next_transfer_id.fetch_add(1, Ordering::Relaxed)
            );
            state
                .outgoing_files
                .lock()
                .map_err(|_| "outgoing transfer state is unavailable")?
                .insert(
                    transfer_id.clone(),
                    OutgoingFile { name: name.clone(), size, sent: 0 },
                );
            let ack_rx = register_ack_waiter(&state.outgoing_ack_waiters, "FILE_START_ACK", &transfer_id)?;
            if let Err(err) = send_to_file_clients(
                &state,
                json!({
                    "action": "FILE_START",
                    "fileId": transfer_id,
                    "fileName": name,
                    "fileSize": size,
                    "chunkSize": 65536,
                    "mimeType": input.get("type").and_then(Value::as_str).unwrap_or("application/octet-stream")
                }),
            ) {
                remove_ack_waiter(&state.outgoing_ack_waiters, "FILE_START_ACK", &transfer_id);
                if let Ok(mut guard) = state.outgoing_files.lock() {
                    guard.remove(&transfer_id);
                }
                return Err(err);
            }
            match tokio::time::timeout(Duration::from_secs(30), ack_rx).await {
                Ok(Ok(Ok(()))) => Ok(json!({ "status": "SUCCESS", "transferId": transfer_id })),
                Ok(Ok(Err(err))) => {
                    if let Ok(mut guard) = state.outgoing_files.lock() {
                        guard.remove(&transfer_id);
                    }
                    Err(err)
                }
                _ => {
                    remove_ack_waiter(&state.outgoing_ack_waiters, "FILE_START_ACK", &transfer_id);
                    if let Ok(mut guard) = state.outgoing_files.lock() {
                        guard.remove(&transfer_id);
                    }
                    let _ = send_to_file_clients(&state, json!({ "action": "FILE_CANCEL", "fileId": transfer_id }));
                    Err("Mobile device did not accept file transfer in time".to_owned())
                }
            }
        }
        "send-file-chunk-data" => {
            let input = args.first().ok_or("file chunk is missing")?;
            let transfer_id = input
                .get("transferId")
                .and_then(Value::as_str)
                .ok_or("transferId is missing")?;
            let offset = input
                .get("offset")
                .and_then(Value::as_u64)
                .ok_or("invalid chunk offset")?;
            let data = input
                .get("data")
                .and_then(Value::as_str)
                .ok_or("chunk data is missing")?;
            let decoded = STANDARD
                .decode(data)
                .map_err(|_| "chunk data is not strict base64")?;
            if decoded.len() > 256 * 1024 {
                return Err("chunk exceeds 256 KiB".to_owned());
            }
            let (size, next_sent) = {
                let transfers = state
                    .outgoing_files
                    .lock()
                    .map_err(|_| "outgoing transfer state is unavailable")?;
                let transfer = transfers
                    .get(transfer_id)
                    .ok_or("unknown outgoing transfer")?;
                let next_sent = transfer.sent + decoded.len() as u64;
                if offset != transfer.sent || next_sent > transfer.size {
                    return Err("out-of-order or oversized chunk".to_owned());
                }
                (transfer.size, next_sent)
            };
            let ack_rx = register_ack_waiter(&state.outgoing_ack_waiters, "FILE_CHUNK_ACK", transfer_id)?;
            if let Err(err) = send_to_file_clients(
                &state,
                json!({
                    "action": "FILE_CHUNK",
                    "fileId": transfer_id,
                    "chunkIndex": offset / 65536,
                    "offset": offset,
                    "data": data,
                    "progress": (next_sent * 100).checked_div(size).unwrap_or(100)
                }),
            ) {
                remove_ack_waiter(&state.outgoing_ack_waiters, "FILE_CHUNK_ACK", transfer_id);
                return Err(err);
            }
            match tokio::time::timeout(Duration::from_secs(15), ack_rx).await {
                Ok(Ok(Ok(()))) => {
                    state
                        .outgoing_files
                        .lock()
                        .map_err(|_| "outgoing transfer state is unavailable")?
                        .get_mut(transfer_id)
                        .ok_or("unknown outgoing transfer")?
                        .sent = next_sent;
                    Ok(json!({ "status": "SUCCESS", "sent": next_sent }))
                }
                Ok(Ok(Err(err))) => {
                    if let Ok(mut guard) = state.outgoing_files.lock() {
                        guard.remove(transfer_id);
                    }
                    Err(err)
                }
                _ => {
                    remove_ack_waiter(&state.outgoing_ack_waiters, "FILE_CHUNK_ACK", transfer_id);
                    if let Ok(mut guard) = state.outgoing_files.lock() {
                        guard.remove(transfer_id);
                    }
                    let _ = send_to_file_clients(&state, json!({ "action": "FILE_CANCEL", "fileId": transfer_id }));
                    Err("Timed out waiting for mobile chunk acknowledgement".to_owned())
                }
            }
        }
        "send-file-end" => {
            let transfer_id = args
                .first()
                .and_then(|value| value.get("transferId"))
                .and_then(Value::as_str)
                .ok_or("transferId is missing")?;
            let (name, size) = {
                let transfers = state
                    .outgoing_files
                    .lock()
                    .map_err(|_| "outgoing transfer state is unavailable")?;
                let transfer = transfers
                    .get(transfer_id)
                    .ok_or("unknown outgoing transfer")?;
                if transfer.sent != transfer.size {
                    return Err(format!("incomplete outgoing file: {}/{}", transfer.sent, transfer.size));
                }
                (transfer.name.clone(), transfer.size)
            };
            let ack_rx = register_ack_waiter(&state.outgoing_ack_waiters, "FILE_END_ACK", transfer_id)?;
            if let Err(err) = send_to_file_clients(
                &state,
                json!({ "action": "FILE_END", "fileId": transfer_id, "fileName": name, "fileSize": size }),
            ) {
                remove_ack_waiter(&state.outgoing_ack_waiters, "FILE_END_ACK", transfer_id);
                return Err(err);
            }
            let ack_res = tokio::time::timeout(Duration::from_secs(15), ack_rx).await;
            state
                .outgoing_files
                .lock()
                .map_err(|_| "outgoing transfer state is unavailable")?
                .remove(transfer_id);
            match ack_res {
                Ok(Ok(Ok(()))) => Ok(json!({ "status": "SUCCESS" })),
                Ok(Ok(Err(err))) => Err(err),
                _ => {
                    remove_ack_waiter(&state.outgoing_ack_waiters, "FILE_END_ACK", transfer_id);
                    Err("Timed out waiting for final file acknowledgement".to_owned())
                }
            }
        }
        "send-file-cancel" => {
            let transfer_id = args
                .first()
                .and_then(|value| value.get("transferId"))
                .and_then(Value::as_str)
                .ok_or("transferId is missing")?;
            state
                .outgoing_files
                .lock()
                .map_err(|_| "outgoing transfer state is unavailable")?
                .remove(transfer_id);
            for act in ["FILE_START_ACK", "FILE_CHUNK_ACK", "FILE_END_ACK"] {
                remove_ack_waiter(&state.outgoing_ack_waiters, act, transfer_id);
            }
            let _ = send_to_file_clients(&state, json!({ "action": "FILE_CANCEL", "fileId": transfer_id }));
            Ok(json!({ "status": "SUCCESS" }))
        }
        "aether-deck:get-document" => {
            let deck = get_deck_service(&state)?;
            Ok(deck.get_document().await)
        }
        "aether-deck:get-providers" => {
            let deck = get_deck_service(&state)?;
            Ok(deck.get_providers().await)
        }
        "aether-deck:save-document" => {
            let deck = get_deck_service(&state)?;
            let doc = args.first().cloned().ok_or("Deck document missing")?;
            deck.save_document(doc).await
        }
        "aether-deck:select-asset" => {
            let deck = get_deck_service(&state)?;
            let picked = tauri::async_runtime::spawn_blocking(|| {
                win_system::open_native_file_dialog(
                    "Выберите иконку для кнопки Aether Deck",
                    "Изображения (*.png;*.jpg;*.jpeg;*.gif;*.webp)",
                    "*.png;*.jpg;*.jpeg;*.gif;*.webp",
                )
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some(path) = picked else {
                return Ok(json!({ "canceled": true }));
            };
            deck.import_asset_from_path(&path)
        }
        "aether-deck:select-application" => {
            let picked = tauri::async_runtime::spawn_blocking(|| {
                win_system::open_native_file_dialog(
                    "Выберите приложение",
                    "Приложения и скрипты (*.exe;*.lnk;*.bat;*.cmd)",
                    "*.exe;*.lnk;*.bat;*.cmd",
                )
            })
            .await
            .map_err(|e| e.to_string())?;
            match picked {
                Some(path) => Ok(json!({ "canceled": false, "path": path.to_string_lossy() })),
                None => Ok(json!({ "canceled": true })),
            }
        }
        "aether-deck:export" => {
            let deck = get_deck_service(&state)?;
            let picked = tauri::async_runtime::spawn_blocking(|| {
                win_system::open_native_save_dialog(
                    "Экспорт конфигурации Aether Deck",
                    "backup.aetherdeck",
                    "Пакет Aether Deck (*.aetherdeck)",
                    "*.aetherdeck",
                )
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some(path) = picked else {
                return Ok(json!({ "canceled": true }));
            };
            deck.export_package_to_path(&path).await
        }
        "aether-deck:import" => {
            let deck = get_deck_service(&state)?;
            let picked = tauri::async_runtime::spawn_blocking(|| {
                win_system::open_native_file_dialog(
                    "Импорт пакета Aether Deck",
                    "Пакет Aether Deck (*.aetherdeck;*.json)",
                    "*.aetherdeck;*.json",
                )
            })
            .await
            .map_err(|e| e.to_string())?;
            let Some(path) = picked else {
                return Ok(json!({ "canceled": true }));
            };
            deck.import_package_from_path(&path).await
        }
        "aether-deck:get-obs-settings" => {
            let deck = get_deck_service(&state)?;
            Ok(deck.get_obs_settings())
        }
        "aether-deck:set-obs-settings" => {
            let deck = get_deck_service(&state)?;
            let cfg = args.first().cloned().unwrap_or(Value::Null);
            let url = cfg
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("ws://127.0.0.1:4455")
                .to_owned();
            let password = cfg
                .get("password")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            deck.set_obs_settings(url, password).await
        }
        "wake-bridge:get-status" => {
            let targets = state
                .wake_targets
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();
            Ok(json!({
                "status": "local",
                "bridgeEnabled": !targets.is_empty(),
                "relayConnected": false,
                "members": [],
                "targets": targets
            }))
        }
        "wake-bridge:set-enabled" => {
            let targets = state
                .wake_targets
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();
            let enabled = first_bool(&args);
            Ok(json!({
                "ok": true,
                "status": {
                    "status": "local",
                    "bridgeEnabled": enabled,
                    "relayConnected": false,
                    "members": [],
                    "targets": targets
                }
            }))
        }
        "wake-bridge:add-target" => {
            let input = args.first().ok_or("wake target missing")?;
            let name = input
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("PC")
                .trim()
                .chars()
                .take(80)
                .collect::<String>();
            let raw_mac = input.get("mac").and_then(Value::as_str).unwrap_or("");
            let (mac, device_id) = storage::normalize_mac_and_id(raw_mac)?;
            let mut guard = state
                .wake_targets
                .lock()
                .map_err(|_| "wake store unavailable")?;
            if !guard.iter().any(|t| t.device_id == device_id) {
                guard.push(WakeTargetRecord {
                    device_id,
                    name: if name.is_empty() { mac.clone() } else { name },
                    mac,
                });
                storage::save_wake_targets(&state.data_dir, &guard);
            }
            Ok(json!({ "ok": true }))
        }
        "wake-bridge:wake-target" => {
            let mac = args
                .first()
                .and_then(Value::as_str)
                .ok_or("target MAC is required")?
                .to_owned();
            tauri::async_runtime::spawn_blocking(move || discovery::send_wol_magic_packet(&mac))
                .await
                .map_err(|e| e.to_string())??;
            Ok(json!({ "ok": true }))
        }
        "wake-bridge:revoke-member" => Ok(json!({ "ok": true })),
        "account:get-state" => Ok(json!({
            "profile": null,
            "busy": false,
            "persistent": false,
            "online": false,
            "unavailable": true,
            "devices": []
        })),
        "account:action" => Ok(json!({
            "ok": false,
            "message": "В локальном автономном режиме используется прямое подключение по QR-коду или PIN-коду."
        })),
        _ => Err(format!("Unsupported IPC command: {channel}")),
    }
}

fn get_deck_service(state: &AppState) -> Result<Arc<DeckService>, String> {
    state
        .deck_service
        .lock()
        .map_err(|_| "deck lock unavailable".to_owned())?
        .clone()
        .ok_or_else(|| "Aether Deck service is still starting".to_owned())
}

fn format_tokens_for_ui(tokens: &[TrustedTokenRecord]) -> Value {
    let items: Vec<Value> = tokens
        .iter()
        .filter(|t| t.trusted)
        .map(|t| {
            json!({
                "token": token_public_id(&t.token),
                "trusted": true,
                "deviceName": t.device_name,
                "ipAddress": t.ip_address,
                "lastUsedAt": t.last_used_at_ms
            })
        })
        .collect();
    Value::Array(items)
}

fn send_to_file_clients(state: &AppState, message: Value) -> Result<(), String> {
    let server = state
        .server
        .lock()
        .map_err(|_| "server state is unavailable")?;
    let srv = server.as_ref().ok_or("Rust host server is not running")?;
    let count = srv.broadcast_to_capability("file-transfer-v2", message);
    if count == 0 {
        return Err("No connected mobile device supports file transfer".to_owned());
    }
    Ok(())
}

fn register_ack_waiter(
    map: &Mutex<HashMap<String, oneshot::Sender<Result<(), String>>>>,
    action: &str,
    file_id: &str,
) -> Result<oneshot::Receiver<Result<(), String>>, String> {
    let (tx, rx) = oneshot::channel();
    let mut guard = map.lock().map_err(|_| "ack waiter lock unavailable")?;
    guard.insert(format!("{action}:{file_id}"), tx);
    Ok(rx)
}

fn remove_ack_waiter(
    map: &Mutex<HashMap<String, oneshot::Sender<Result<(), String>>>>,
    action: &str,
    file_id: &str,
) {
    if let Ok(mut guard) = map.lock() {
        guard.remove(&format!("{action}:{file_id}"));
    }
}

fn first_bool(args: &[Value]) -> bool {
    args.first().and_then(Value::as_bool).unwrap_or(false)
}

fn remove_pending(pending: &PendingApprovals, request_id: &str) {
    if let Ok(mut requests) = pending.lock() {
        requests.remove(request_id);
    }
}

fn clipboard_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let mut hex = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    hex
}

fn detect_identity() -> (HostIdentity, win_system::NetworkDiscovery) {
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Aether Host".to_owned());
    let discovery = win_system::detect_network_endpoints(&hostname);
    let mac_address = mac_address::get_mac_address()
        .ok()
        .flatten()
        .map(|address| address.to_string().to_uppercase())
        .unwrap_or_default();
    let hardware_pin = generate_pairing_secret();
    let identity = HostIdentity {
        hostname,
        ip_address: Arc::new(RwLock::new(discovery.primary_ip.clone())),
        endpoints: Arc::new(RwLock::new(discovery.endpoints.clone())),
        mac_address,
        hardware_pin: Arc::new(RwLock::new(hardware_pin)),
    };
    (identity, discovery)
}

fn pairing_code_for_ip(ip_address: &str, hardware_pin: &str) -> String {
    let octets: Vec<_> = ip_address.split('.').collect();
    let third = octets
        .get(2)
        .and_then(|value| value.parse::<u8>().ok())
        .unwrap_or(1);
    let fourth = octets
        .get(3)
        .and_then(|value| value.parse::<u8>().ok())
        .unwrap_or(50);
    format!("{third:03}{fourth:03}{hardware_pin}")
}

fn secret_matches_any_endpoint(
    clean_candidate: &str,
    endpoints: &[win_system::NetworkEndpointInfo],
    primary_ip: &str,
    secret: &str,
) -> bool {
    if secret.len() != 6 || !secret.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    endpoints.iter().any(|ep| {
        let code12 = pairing_code_for_ip(&ep.address, secret);
        constant_time_text_eq(clean_candidate, &code12)
    }) || constant_time_text_eq(clean_candidate, &pairing_code_for_ip(primary_ip, secret))
}

fn validate_pairing_code_with_grace(
    candidate: &str,
    endpoints: &[win_system::NetworkEndpointInfo],
    primary_ip: &str,
    current_secret: &str,
    previous_secret: Option<&str>,
) -> bool {
    let clean: String = candidate.chars().filter(|c| c.is_ascii_digit()).collect();
    if clean.len() != 12 {
        return false;
    }
    secret_matches_any_endpoint(&clean, endpoints, primary_ip, current_secret)
        || previous_secret.is_some_and(|prev| {
            secret_matches_any_endpoint(&clean, endpoints, primary_ip, prev)
        })
}

fn setup_tray_icon(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id("show", "Показать Aether Remote").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Выход").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Aether Remote")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
                && let Some(window) = tray.app_handle().get_webview_window("main")
            {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    if !win_system::try_acquire_single_instance_or_focus() {
        return;
    }

    tauri::Builder::default()
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            win_system::sync_autostart_path_if_enabled();

            let data_dir = storage::app_data_dir();
            let settings = storage::load_settings(&data_dir);
            let wake_targets = storage::load_wake_targets(&data_dir);
            let persisted_tokens = storage::load_trusted_tokens(&data_dir);
            let (identity, net_discovery) = detect_identity();
            let pending_approvals = Arc::new(Mutex::new(HashMap::new()));

            let tls_pair =
                storage::load_or_create_tls_identity(&data_dir, &net_discovery.san_entries).ok();
            let tls_fingerprint = tls_pair.as_ref().map(|(_, fp)| fp.clone());

            let init_primary_ip = identity
                .ip_address
                .read()
                .map(|g| g.clone())
                .unwrap_or_else(|_| "127.0.0.1".to_owned());
            let discovery_identity = Arc::new(RwLock::new(DiscoveryIdentity {
                hostname: identity.hostname.clone(),
                mac: identity.mac_address.clone(),
                port: HOST_PORT,
                tls_fingerprint: tls_fingerprint.clone().unwrap_or_default(),
                primary_ip: init_primary_ip.clone(),
                broadcast_targets: net_discovery.broadcast_targets.clone(),
            }));

            app.manage(AppState::new(
                data_dir.clone(),
                identity.clone(),
                pending_approvals.clone(),
                settings.clone(),
                wake_targets,
            ));

            if let Some(ref fp) = tls_fingerprint
                && let Ok(mut current) = app.state::<AppState>().tls_fingerprint.lock()
            {
                *current = Some(fp.clone());
            }

            if settings.clipboard_sharing
                && let Ok(clip) = clipboard_win::get_clipboard_string()
                && !clip.trim().is_empty()
                && let Ok(mut guard) = app.state::<AppState>().last_clipboard_hash.lock()
            {
                *guard = clipboard_hash(&clip);
            }

            let _ = setup_tray_icon(app);

            let approval_gate = Arc::new(TauriApprovalGate {
                app: app.handle().clone(),
                pending: pending_approvals,
            });
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let listener = match tokio::net::TcpListener::bind(("0.0.0.0", HOST_PORT)).await {
                    Ok(listener) => listener,
                    Err(error) => {
                        let msg = format!(
                            "Failed to bind host server on port {HOST_PORT}: {error}. Another instance of Aether Remote or another service is already using this port."
                        );
                        if let Ok(mut err_guard) = app_handle.state::<AppState>().server_error.lock() {
                            *err_guard = Some(msg.clone());
                        }
                        present_main_window(&app_handle, true);
                        let _ = app_handle.emit("server-error", msg);
                        return;
                    }
                };

                let (outbound_tx, _) = broadcast::channel(128);
                let media_provider = Arc::new(WindowsMedia);
                let deck_executor = Arc::new(TauriDeckExecutor {
                    app: app_handle.clone(),
                    media: media_provider.clone(),
                });
                let deck_service = Arc::new(DeckService::new(
                    data_dir.clone(),
                    deck_executor,
                    approval_gate.clone(),
                    outbound_tx.clone(),
                ));
                if let Ok(mut guard) = app_handle.state::<AppState>().deck_service.lock() {
                    *guard = Some(deck_service.clone());
                }
                let obs_deck = deck_service.clone();
                tauri::async_runtime::spawn(async move {
                    obs_deck.try_connect_saved_obs().await;
                });

                let telemetry = Arc::new(SystemTelemetry {
                    previous_cpu: Arc::new(Mutex::new(None)),
                    previous_net: Arc::new(Mutex::new(None)),
                    hostname: identity.hostname.clone(),
                });

                let event_sink = Arc::new(TauriHostSink {
                    app: app_handle.clone(),
                    data_dir: data_dir.clone(),
                    last_clipboard_hash: app_handle.state::<AppState>().last_clipboard_hash.clone(),
                    outgoing_ack_waiters: app_handle.state::<AppState>().outgoing_ack_waiters.clone(),
                });

                let previous_pin_window: Arc<Mutex<Option<(String, std::time::Instant)>>> =
                    Arc::new(Mutex::new(None));

                let pin_validator: Arc<dyn Fn(&str) -> bool + Send + Sync> = {
                    let hardware_pin = identity.hardware_pin.clone();
                    let prev_pin = previous_pin_window.clone();
                    let hostname_copy = identity.hostname.clone();
                    Arc::new(move |candidate: &str| {
                        let current_secret = hardware_pin
                            .read()
                            .map(|g| g.clone())
                            .unwrap_or_default();
                        let previous_secret = prev_pin
                            .lock()
                            .ok()
                            .and_then(|g| g.as_ref().filter(|(_, ts)| ts.elapsed() <= Duration::from_secs(60)).map(|(s, _)| s.clone()));
                        let disc = win_system::detect_network_endpoints(&hostname_copy);
                        validate_pairing_code_with_grace(
                            candidate,
                            &disc.endpoints,
                            &disc.primary_ip,
                            &current_secret,
                            previous_secret.as_deref(),
                        )
                    })
                };

                let config = ServerConfig {
                    pin: {
                        let hardware_pin = identity.hardware_pin.clone();
                        let hostname_copy = identity.hostname.clone();
                        Arc::new(move || {
                            let disc = win_system::detect_network_endpoints(&hostname_copy);
                            let current_secret = hardware_pin
                                .read()
                                .map(|g| g.clone())
                                .unwrap_or_default();
                            pairing_code_for_ip(&disc.primary_ip, &current_secret)
                        })
                    },
                    pin_validator: Some(pin_validator),
                    hostname: identity.hostname.clone(),
                    mac: identity.mac_address.clone(),
                    port: HOST_PORT,
                    download_folder: settings.download_folder.clone(),
                    dynamic_download_folder: Some(app_handle.state::<AppState>().download_folder.clone()),
                    approval_gate,
                    telemetry: telemetry.clone(),
                    clipboard: Arc::new(WindowsClipboard),
                    media: media_provider,
                    tls_config: tls_pair,
                    tls_fingerprint: tls_fingerprint.clone(),
                    persisted_tokens,
                    events: Some(event_sink),
                    deck_service: Some(deck_service.clone()),
                    audio_hub: None,
                    outbound_tx: Some(outbound_tx),
                    require_tls_for_lan: true,
                };

                match aether_host_server::spawn(listener, config).await {
                    Ok(server) => {
                        if let Ok(mut err_guard) = app_handle.state::<AppState>().server_error.lock() {
                            *err_guard = None;
                        }
                        if let Ok(mut target) = app_handle.state::<AppState>().server.lock() {
                            *target = Some(server);
                        }
                        let disc_shutdown =
                            discovery::spawn_discovery_services(discovery_identity.clone());
                        if let Ok(mut ds) = app_handle.state::<AppState>().discovery_shutdown.lock() {
                            *ds = Some(disc_shutdown);
                        }

                        let init_endpoints = identity
                            .endpoints
                            .read()
                            .map(|g| g.clone())
                            .unwrap_or_default();
                        let init_secret = identity
                            .hardware_pin
                            .read()
                            .map(|g| g.clone())
                            .unwrap_or_default();
                        let _ = app_handle.emit(
                            "server-started",
                            json!({
                                "ip": init_primary_ip,
                                "networkEndpoints": init_endpoints,
                                "port": HOST_PORT,
                                "tlsFingerprint": tls_fingerprint
                            }),
                        );
                        let _ = app_handle.emit(
                            "hardware-info-updated",
                            json!({
                                "hardwarePin": init_secret,
                                "pairingCode": pairing_code_for_ip(&init_primary_ip, &init_secret),
                                "ipAddress": init_primary_ip,
                                "networkEndpoints": init_endpoints,
                                "tlsFingerprint": tls_fingerprint
                            }),
                        );

                        // Periodic UI telemetry broadcaster, network/PIN rotation, Deck runtime vars & clipboard sync
                        let bg_app = app_handle.clone();
                        let bg_telemetry = telemetry.clone();
                        let bg_deck = deck_service.clone();
                        tokio::spawn(async move {
                            let mut tick = tokio::time::interval(Duration::from_millis(1500));
                            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                            let mut last_primary_ip = init_primary_ip;
                            let mut last_endpoints_key = serde_json::to_string(&init_endpoints).unwrap_or_default();
                            let mut last_pin_rotation = std::time::Instant::now();
                            loop {
                                tick.tick().await;
                                let (count, streaming, active_client, disc_update, current_fp, current_pin) = {
                                    let st = bg_app.state::<AppState>();
                                    let (cnt, stream, first) = if let Ok(srv_guard) = st.server.lock()
                                        && let Some(ref srv) = *srv_guard
                                    {
                                        let snap = srv.connected_clients_snapshot();
                                        (snap.len(), srv.is_any_streaming(), snap.into_iter().next())
                                    } else {
                                        (0, false, None)
                                    };
                                    let ep = win_system::detect_network_endpoints(&st.identity.hostname);
                                    let fp = st.tls_fingerprint.lock().ok().and_then(|g| g.clone()).unwrap_or_default();
                                    let pin = st.identity.hardware_pin.read().map(|g| g.clone()).unwrap_or_default();
                                    (cnt, stream, first, ep, fp, pin)
                                };

                                if let Ok(mut d) = discovery_identity.write() {
                                    d.primary_ip = disc_update.primary_ip.clone();
                                    d.broadcast_targets = disc_update.broadcast_targets.clone();
                                }

                                let ep_key = serde_json::to_string(&disc_update.endpoints).unwrap_or_default();
                                let network_changed = disc_update.primary_ip != last_primary_ip || ep_key != last_endpoints_key;
                                let pin_due = last_pin_rotation.elapsed() >= Duration::from_secs(600);
                                if network_changed || pin_due {
                                    let st = bg_app.state::<AppState>();
                                    let effective_pin = if pin_due {
                                        let next = generate_pairing_secret();
                                        if let Ok(mut prev_g) = previous_pin_window.lock()
                                            && current_pin.len() == 6
                                        {
                                            *prev_g = Some((current_pin.clone(), std::time::Instant::now()));
                                        }
                                        if let Ok(mut p) = st.identity.hardware_pin.write() {
                                            *p = next.clone();
                                        }
                                        last_pin_rotation = std::time::Instant::now();
                                        next
                                    } else {
                                        current_pin
                                    };
                                    if network_changed {
                                        if let Ok(mut ip_w) = st.identity.ip_address.write() {
                                            *ip_w = disc_update.primary_ip.clone();
                                        }
                                        if let Ok(mut ep_w) = st.identity.endpoints.write() {
                                            *ep_w = disc_update.endpoints.clone();
                                        }
                                        last_primary_ip = disc_update.primary_ip.clone();
                                        last_endpoints_key = ep_key;
                                    }
                                    let _ = bg_app.emit(
                                        "hardware-info-updated",
                                        json!({
                                            "hardwarePin": effective_pin,
                                            "pairingCode": pairing_code_for_ip(&disc_update.primary_ip, &effective_pin),
                                            "ipAddress": disc_update.primary_ip,
                                            "networkEndpoints": disc_update.endpoints,
                                            "tlsFingerprint": current_fp
                                        }),
                                    );
                                }

                                let payload = bg_telemetry
                                    .detailed_snapshot(count, streaming, active_client)
                                    .await;
                                let _ = bg_app.emit("telemetry-update", payload.clone());

                                if count > 0 {
                                    let (obs_conn, obs_stream, obs_rec) = bg_deck.obs_state();
                                    let mut vars = serde_json::Map::new();
                                    if let Some(v) = payload.get("cpu") {
                                        vars.insert("system.cpu".to_owned(), v.clone());
                                    }
                                    if let Some(v) = payload.get("ram") {
                                        vars.insert("system.ram".to_owned(), v.clone());
                                    }
                                    if let Some(v) = payload.get("hostname") {
                                        vars.insert("system.hostname".to_owned(), v.clone());
                                    }
                                    if let Some(v) = payload.get("volume") {
                                        vars.insert("audio.volume".to_owned(), v.clone());
                                    }
                                    if let Some(v) = payload.get("isMuted") {
                                        vars.insert("audio.muted".to_owned(), v.clone());
                                    }
                                    if let Some(v) = payload.get("track") {
                                        vars.insert("media.track".to_owned(), v.clone());
                                    }
                                    if let Some(v) = payload.get("artist") {
                                        vars.insert("media.artist".to_owned(), v.clone());
                                    }
                                    if let Some(v) = payload.get("isPlaying") {
                                        vars.insert("media.playing".to_owned(), v.clone());
                                    }
                                    vars.insert("system.connectedClients".to_owned(), json!(count));
                                    vars.insert("stream.screen".to_owned(), json!(streaming));
                                    vars.insert("obs.connected".to_owned(), json!(obs_conn));
                                    vars.insert("obs.streaming".to_owned(), json!(obs_stream));
                                    vars.insert("obs.recording".to_owned(), json!(obs_rec));
                                    bg_deck.publish_runtime_variables(vars).await;
                                }

                                let st = bg_app.state::<AppState>();
                                if st.clipboard_sharing.load(Ordering::Relaxed) && count > 0
                                    && let Ok(clip) = tauri::async_runtime::spawn_blocking(clipboard_win::get_clipboard_string).await
                                    && let Ok(text) = clip
                                    && !text.trim().is_empty()
                                    && text.chars().count() <= 100_000
                                {
                                    let h = clipboard_hash(&text);
                                    let changed = st
                                        .last_clipboard_hash
                                        .lock()
                                        .map(|mut prev| {
                                            if *prev != h {
                                                *prev = h;
                                                true
                                            } else {
                                                false
                                            }
                                        })
                                        .unwrap_or(false);
                                    if changed
                                        && let Ok(srv_guard) = st.server.lock()
                                        && let Some(ref srv) = *srv_guard
                                    {
                                        srv.broadcast_to_capability(
                                            "clipboard-history-v1",
                                            json!({
                                                "action": "CLIPBOARD_ITEM",
                                                "text": text,
                                                "source": "pc",
                                                "createdAt": aether_host_server::now_millis()
                                            }),
                                        );
                                    }
                                }
                            }
                        });
                    }
                    Err(error) => {
                        let msg = format!("Host server failed to start: {error}");
                        if let Ok(mut err_guard) = app_handle.state::<AppState>().server_error.lock() {
                            *err_guard = Some(msg.clone());
                        }
                        present_main_window(&app_handle, true);
                        let _ = app_handle.emit("server-error", msg);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppState>();
                if state.minimize_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![ipc_send, ipc_invoke])
        .run(tauri::generate_context!())
        .expect("failed to run Aether Remote Tauri host");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_uses_a_six_digit_secret() {
        let first = generate_pairing_secret();
        assert_eq!(first.len(), 6);
        assert!(first.bytes().all(|b| b.is_ascii_digit()));
        let unique: std::collections::HashSet<String> =
            (0..8).map(|_| generate_pairing_secret()).collect();
        assert!(unique.len() > 1);
        assert_eq!(pairing_code_for_ip("192.168.1.42", "654321"), "001042654321");
    }

    #[test]
    fn pairing_validator_honors_multi_endpoint_and_rotation_grace() {
        let endpoints = vec![
            win_system::NetworkEndpointInfo {
                address: "192.168.31.192".to_owned(),
                interface_name: "Wi-Fi".to_owned(),
                kind: "lan".to_owned(),
            },
            win_system::NetworkEndpointInfo {
                address: "100.64.0.5".to_owned(),
                interface_name: "Tailscale".to_owned(),
                kind: "vpn".to_owned(),
            },
        ];
        assert!(validate_pairing_code_with_grace(
            "031192222222",
            &endpoints,
            "192.168.31.192",
            "222222",
            Some("111111"),
        ));
        // Previous PIN remains accepted during the 60s rotation grace window
        assert!(validate_pairing_code_with_grace(
            "000005111111",
            &endpoints,
            "192.168.31.192",
            "222222",
            Some("111111"),
        ));
        // Wrong or expired secret is rejected
        assert!(!validate_pairing_code_with_grace(
            "031192111111",
            &endpoints,
            "192.168.31.192",
            "222222",
            None,
        ));
        assert!(!validate_pairing_code_with_grace(
            "222222",
            &endpoints,
            "192.168.31.192",
            "222222",
            None,
        ));
    }

    #[test]
    fn windows_memory_snapshot_is_sane() {
        let (total, used) = windows_memory_bytes().expect("Windows memory status");
        assert!(total > 0.0);
        assert!((0.0..=total).contains(&used));
    }

    #[test]
    fn windows_cpu_snapshot_stays_in_percent_range() {
        let previous = Mutex::new(None);
        let first = windows_cpu_percent(&previous).expect("Windows CPU status");
        std::thread::sleep(Duration::from_millis(20));
        let second = windows_cpu_percent(&previous).expect("Windows CPU status");
        assert!((0.0..=100.0).contains(&first));
        assert!((0.0..=100.0).contains(&second));
    }

    #[test]
    fn windows_uptime_is_nonzero() {
        assert!(windows_uptime_seconds() > 0);
    }
}
