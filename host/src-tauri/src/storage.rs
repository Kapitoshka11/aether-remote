use std::fs;
use std::path::{Path, PathBuf};

use aether_host_server::TrustedTokenRecord;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSettings {
    pub download_folder: PathBuf,
    pub minimize_to_tray: bool,
    pub clipboard_sharing: bool,
}

impl Default for HostSettings {
    fn default() -> Self {
        let dl = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(dirs::download_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Downloads")
            .join("AetherRemote");
        Self {
            download_folder: dl,
            minimize_to_tray: true,
            clipboard_sharing: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeTargetRecord {
    pub device_id: String,
    pub name: String,
    pub mac: String,
}

pub fn app_data_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AetherRemote");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn load_settings(dir: &Path) -> HostSettings {
    let path = dir.join("settings.json");
    let mut settings = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<HostSettings>(&s).ok())
        .unwrap_or_default();
    if settings.download_folder.as_os_str().is_empty() {
        settings.download_folder = HostSettings::default().download_folder;
    }
    let _ = fs::create_dir_all(&settings.download_folder);
    settings
}

pub fn save_settings(dir: &Path, settings: &HostSettings) {
    let _ = fs::create_dir_all(dir);
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = write_atomic(&dir.join("settings.json"), json.as_bytes());
    }
}

pub fn load_or_create_tls_identity(
    dir: &Path,
    san_entries: &[String],
) -> Result<(aether_host_server::TlsServerConfig, String), Box<dyn std::error::Error + Send + Sync>> {
    let cert_path = dir.join("tls-cert.der");
    let key_path = dir.join("tls-key.der");
    let sans_path = dir.join("tls-sans.json");

    // Reuse existing TLS identity even when LAN/VPN SAN IPs change so already-paired
    // phones with pinned fingerprints are not locked out; regenerate only if corrupt or expiring.
    if let (Ok(cert_der), Ok(key_der)) = (fs::read(&cert_path), fs::read(&key_path))
        && aether_host_server::cert_is_currently_valid(&cert_der, 30 * 86_400)
        && let Ok(pair) = aether_host_server::server_config_from_der(cert_der, key_der)
    {
        return Ok(pair);
    }

    let (sc, fp, cert_der, key_der) = aether_host_server::generate_self_signed_cert_with_der(san_entries)?;
    let _ = fs::create_dir_all(dir);
    let _ = write_atomic(&cert_path, &cert_der);
    let _ = write_atomic(&key_path, &key_der);
    if let Ok(sans_json) = serde_json::to_string(&san_entries) {
        let _ = write_atomic(&sans_path, sans_json.as_bytes());
    }
    Ok((sc, fp))
}

pub fn load_trusted_tokens(dir: &Path) -> Vec<TrustedTokenRecord> {
    let path = dir.join("trusted-tokens.json");
    let now = aether_host_server::now_millis();
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<TrustedTokenRecord>>(&s).ok())
        .map(|list| list.into_iter().filter(|t| t.expires_at_ms > now).collect())
        .unwrap_or_default()
}

pub fn save_trusted_tokens(dir: &Path, tokens: &[TrustedTokenRecord]) {
    let _ = fs::create_dir_all(dir);
    if let Ok(json) = serde_json::to_string_pretty(tokens) {
        let _ = write_atomic(&dir.join("trusted-tokens.json"), json.as_bytes());
    }
}

pub fn load_wake_targets(dir: &Path) -> Vec<WakeTargetRecord> {
    let path = dir.join("wake-targets.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<WakeTargetRecord>>(&s).ok())
        .unwrap_or_default()
}

pub fn save_wake_targets(dir: &Path, targets: &[WakeTargetRecord]) {
    let _ = fs::create_dir_all(dir);
    if let Ok(json) = serde_json::to_string_pretty(targets) {
        let _ = write_atomic(&dir.join("wake-targets.json"), json.as_bytes());
    }
}

pub fn normalize_mac_and_id(raw_mac: &str) -> Result<(String, String), String> {
    let hex_only: String = raw_mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex_only.len() != 12 {
        return Err("MAC address must contain 12 hex characters".to_owned());
    }
    let formatted = (0..6)
        .map(|i| hex_only[i * 2..i * 2 + 2].to_ascii_uppercase())
        .collect::<Vec<_>>()
        .join(":");
    let digest = Sha256::digest(format!("AETHER_WAKE_TARGET:{formatted}").as_bytes());
    let mut id_hex = String::with_capacity(32);
    for b in &digest[..16] {
        use std::fmt::Write;
        let _ = write!(&mut id_hex, "{:02x}", b);
    }
    Ok((formatted, id_hex))
}

fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = target.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, target).or_else(|_| {
        let _ = fs::remove_file(target);
        fs::rename(&tmp, target)
    })
}

#[cfg(test)]
mod tests {
    use super::load_or_create_tls_identity;

    #[test]
    fn tls_identity_remains_stable_across_san_and_ip_changes() {
        let unique = format!(
            "aether_tls_test_{}_{}",
            std::process::id(),
            aether_host_server::now_millis()
        );
        let dir = std::env::temp_dir().join(unique);
        let _ = std::fs::remove_dir_all(&dir);

        let (_, fp1) =
            load_or_create_tls_identity(&dir, &["192.168.1.10".to_owned(), "host".to_owned()])
                .expect("create initial cert");
        // Adding a new VPN IP or changing DHCP address must keep the pinned fingerprint intact
        let (_, fp2) = load_or_create_tls_identity(
            &dir,
            &[
                "192.168.1.44".to_owned(),
                "100.64.0.2".to_owned(),
                "host".to_owned(),
            ],
        )
        .expect("reuse cert across IP changes");
        assert_eq!(fp1, fp2);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
