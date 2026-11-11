use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use aether_host_server::{
    Approval, ApprovalGate, EmptyTelemetry, NoClipboard, NoMedia, PairingRequest, ServerConfig,
    cert_is_currently_valid, constant_time_text_eq, generate_self_signed_cert_with_der,
    server_config_from_der, spawn,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::net::{TcpListener, UdpSocket};

struct DelayedApprovalGate {
    delay: Duration,
    trusted: bool,
}

#[async_trait]
impl ApprovalGate for DelayedApprovalGate {
    async fn approve(&self, _request: PairingRequest) -> Approval {
        if !self.delay.is_zero() {
            tokio::time::sleep(self.delay).await;
        }
        Approval {
            approved: true,
            trusted: self.trusted,
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut input_line = String::new();
    let _ = std::io::stdin().lock().read_line(&mut input_line);
    let parsed: Value = serde_json::from_str(input_line.trim()).unwrap_or_else(|_| json!({}));

    let pin12 = parsed
        .get("pin12")
        .and_then(Value::as_str)
        .filter(|s| s.len() == 12 && s.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or("000001654321")
        .to_owned();
    let approval_delay_ms = parsed
        .get("approvalDelayMs")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let trusted = parsed
        .get("trusted")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let (_, fp, cert_der, key_der) = generate_self_signed_cert_with_der(&[
        "127.0.0.1".to_owned(),
        "localhost".to_owned(),
        "AETHER-FIXTURE".to_owned(),
    ])?;
    let cert_valid = cert_is_currently_valid(&cert_der, 30 * 86_400);
    let tls_pair = server_config_from_der(cert_der, key_der)?;

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let udp_sock = UdpSocket::bind("127.0.0.1:0").await?;
    let udp_port = udp_sock.local_addr()?.port();

    let pin_validator_secret = pin12.clone();
    let pin_for_config = pin12.clone();
    let temp_dir: PathBuf = std::env::temp_dir().join(format!(
        "aether-android-fixture-{}-{}",
        std::process::id(),
        port
    ));

    let config = ServerConfig {
        pin: Arc::new(move || pin_for_config.clone()),
        pin_validator: Some(Arc::new(move |candidate: &str| {
            let clean: String = candidate.chars().filter(|c| c.is_ascii_digit()).collect();
            clean.len() == 12 && constant_time_text_eq(&clean, &pin_validator_secret)
        })),
        hostname: "AETHER-FIXTURE".to_owned(),
        mac: "AA:BB:CC:DD:EE:FF".to_owned(),
        port,
        download_folder: temp_dir.clone(),
        dynamic_download_folder: None,
        approval_gate: Arc::new(DelayedApprovalGate {
            delay: Duration::from_millis(approval_delay_ms),
            trusted,
        }),
        telemetry: Arc::new(EmptyTelemetry),
        clipboard: Arc::new(NoClipboard),
        media: Arc::new(NoMedia),
        tls_config: Some(tls_pair),
        tls_fingerprint: Some(fp.clone()),
        persisted_tokens: Vec::new(),
        events: None,
        deck_service: None,
        audio_hub: None,
        outbound_tx: None,
        require_tls_for_lan: true,
    };

    let server = spawn(listener, config).await?;

    let beacon_payload = json!({
        "service": "aether-remote",
        "ip": "127.0.0.1",
        "port": port,
        "host": "AETHER-FIXTURE",
        "mac": "AA:BB:CC:DD:EE:FF",
        "protocolVersion": "2.0",
        "secure": true,
        "tlsFingerprint": fp
    })
    .to_string()
    .into_bytes();

    let udp_task = tokio::spawn(async move {
        let mut buf = [0u8; 512];
        loop {
            let Ok((len, peer)) = udp_sock.recv_from(&mut buf).await else {
                break;
            };
            let trimmed = buf[..len].trim_ascii();
            if !trimmed.is_empty() && trimmed.starts_with(b"AETHER_DISCOVER") {
                let _ = udp_sock.send_to(&beacon_payload, peer).await;
            }
        }
    });

    println!(
        "{}",
        json!({
            "port": port,
            "udpPort": udp_port,
            "fingerprint": fp,
            "pin12": pin12,
            "certValid": cert_valid
        })
    );
    let _ = std::io::stdout().flush();

    let _ = tokio::task::spawn_blocking(|| {
        let stdin = std::io::stdin();
        let mut buf = String::new();
        while let Ok(n) = stdin.lock().read_line(&mut buf) {
            if n == 0 || buf.trim() == "EXIT" {
                break;
            }
            buf.clear();
        }
    })
    .await;

    udp_task.abort();
    let _ = server.shutdown().await;
    let _ = std::fs::remove_dir_all(&temp_dir);
    Ok(())
}
