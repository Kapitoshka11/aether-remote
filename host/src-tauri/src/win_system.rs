use std::ffi::OsStr;
use std::net::{IpAddr, Ipv4Addr};
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkEndpointInfo {
    pub address: String,
    pub interface_name: String,
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct NetworkDiscovery {
    pub primary_ip: String,
    pub endpoints: Vec<NetworkEndpointInfo>,
    pub broadcast_targets: Vec<Ipv4Addr>,
    pub san_entries: Vec<String>,
}

fn is_virtual_interface_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        "vethernet",
        "virtualbox",
        "vmware",
        "wsl",
        "hyper-v",
        "docker",
        "loopback",
        "teredo",
        "isatap",
        "6to4",
        "bluetooth",
        "npcap",
        "vboxnet",
        "km-test",
        "virtual switch",
        "virtual ethernet",
    ]
    .iter()
    .any(|kw| lower.contains(kw))
}

fn is_vpn_interface(name: &str, ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    let is_cgnat_tailscale = octets[0] == 100 && (64..=127).contains(&octets[1]);
    let lower = name.to_ascii_lowercase();
    let substr_match = [
        "tailscale",
        "wireguard",
        "wintun",
        "openvpn",
        "tap-windows",
        "proton",
        "nord",
        "zero",
        "radmin",
        "hamachi",
        "slarp",
        "sing-box",
        "singbox",
        "clash",
        "mihomo",
        "nekoray",
        "hiddify",
        "amnezia",
        "outline",
        "v2ray",
        "xray",
        "mullvad",
        "surfshark",
        "windscribe",
        "proxifier",
        "softether",
        "anyconnect",
        "globalprotect",
        "warp",
        "utun",
    ]
    .iter()
    .any(|kw| lower.contains(kw));
    let token_match = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|tok| !tok.is_empty())
        .any(|tok| {
            matches!(tok, "tun" | "tap" | "wg" | "vpn")
                || (tok.starts_with("tun") && tok[3..].chars().all(|c| c.is_ascii_digit()))
                || (tok.starts_with("wg") && tok[2..].chars().all(|c| c.is_ascii_digit()))
        });
    is_cgnat_tailscale || substr_match || token_match
}

#[derive(Debug, Clone)]
struct RawAdapterAddress {
    friendly_name: String,
    description: String,
    ip: IpAddr,
    prefix_len: u8,
    has_gateway: bool,
    metric: u32,
    is_tunnel_or_ppp: bool,
    is_virtual_iftype: bool,
}

fn directed_broadcast_for_v4(ip: Ipv4Addr, prefix_len: u8) -> Option<Ipv4Addr> {
    if prefix_len == 0 {
        let oct = ip.octets();
        return Some(Ipv4Addr::new(oct[0], oct[1], oct[2], 255));
    }
    if prefix_len >= 31 {
        return None;
    }
    let host_mask = (1u32 << (32 - prefix_len)) - 1;
    Some(Ipv4Addr::from(u32::from(ip) | host_mask))
}

unsafe fn pwstr_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    unsafe {
        while *ptr.add(len) != 0 && len < 512 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }
}

fn collect_windows_adapter_addresses() -> Option<Vec<RawAdapterAddress>> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GAA_FLAG_INCLUDE_GATEWAYS, GetAdaptersAddresses, IF_TYPE_PROP_VIRTUAL, IF_TYPE_TUNNEL,
        IP_ADAPTER_ADDRESSES_LH, MIB_IF_TYPE_LOOPBACK, MIB_IF_TYPE_PPP,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::{
        AF_INET, AF_INET6, AF_UNSPEC, SOCKADDR_IN, SOCKADDR_IN6,
    };

    const ERROR_BUFFER_OVERFLOW_U32: u32 = 111;
    let flags = GAA_FLAG_INCLUDE_GATEWAYS;
    let mut buf_len: u32 = 16 * 1024;
    let mut aligned_buf: Vec<u64> = Vec::new();

    for _ in 0..4 {
        aligned_buf.resize((buf_len as usize).div_ceil(std::mem::size_of::<u64>()), 0u64);
        let rc = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC as u32,
                flags,
                std::ptr::null(),
                aligned_buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut buf_len,
            )
        };
        if rc == 0 {
            break;
        }
        if rc != ERROR_BUFFER_OVERFLOW_U32 {
            return None;
        }
    }

    if aligned_buf.is_empty() {
        return None;
    }

    let mut out = Vec::new();
    let mut ptr = aligned_buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    unsafe {
        while !ptr.is_null() {
            let adapter = &*ptr;
            if adapter.OperStatus == IfOperStatusUp && adapter.IfType != MIB_IF_TYPE_LOOPBACK {
                let friendly_name = pwstr_to_string(adapter.FriendlyName);
                let description = pwstr_to_string(adapter.Description);
                let has_gateway = !adapter.FirstGatewayAddress.is_null();
                let is_tunnel_or_ppp =
                    adapter.IfType == IF_TYPE_TUNNEL || adapter.IfType == MIB_IF_TYPE_PPP;
                let is_virtual_iftype = adapter.IfType == IF_TYPE_PROP_VIRTUAL;

                let mut u = adapter.FirstUnicastAddress;
                while !u.is_null() {
                    let unicast = &*u;
                    let sa_ptr = unicast.Address.lpSockaddr;
                    let sa_len = unicast.Address.iSockaddrLength as usize;
                    if !sa_ptr.is_null() && sa_len >= std::mem::size_of::<u16>() {
                        let family = (*sa_ptr).sa_family;
                        if family == AF_INET && sa_len >= std::mem::size_of::<SOCKADDR_IN>() {
                            let sa4 = &*(sa_ptr as *const SOCKADDR_IN);
                            let b = sa4.sin_addr.S_un.S_un_b;
                            let v4 = Ipv4Addr::new(b.s_b1, b.s_b2, b.s_b3, b.s_b4);
                            out.push(RawAdapterAddress {
                                friendly_name: friendly_name.clone(),
                                description: description.clone(),
                                ip: IpAddr::V4(v4),
                                prefix_len: unicast.OnLinkPrefixLength,
                                has_gateway,
                                metric: adapter.Ipv4Metric,
                                is_tunnel_or_ppp,
                                is_virtual_iftype,
                            });
                        } else if family == AF_INET6 && sa_len >= std::mem::size_of::<SOCKADDR_IN6>()
                        {
                            let sa6 = &*(sa_ptr as *const SOCKADDR_IN6);
                            let v6 = std::net::Ipv6Addr::from(sa6.sin6_addr.u.Byte);
                            out.push(RawAdapterAddress {
                                friendly_name: friendly_name.clone(),
                                description: description.clone(),
                                ip: IpAddr::V6(v6),
                                prefix_len: unicast.OnLinkPrefixLength,
                                has_gateway,
                                metric: adapter.Ipv6Metric,
                                is_tunnel_or_ppp,
                                is_virtual_iftype,
                            });
                        }
                    }
                    u = unicast.Next;
                }
            }
            ptr = adapter.Next;
        }
    }
    Some(out)
}

fn build_network_discovery(hostname: &str, raw_addrs: Vec<RawAdapterAddress>) -> NetworkDiscovery {
    let mut physical = Vec::new();
    let mut vpn = Vec::new();
    let mut broadcast_targets = Vec::new();
    let mut san_entries = vec![
        hostname.to_owned(),
        "127.0.0.1".to_owned(),
        "::1".to_owned(),
        "localhost".to_owned(),
    ];

    for raw in raw_addrs {
        if raw.ip.is_loopback() || raw.ip.is_unspecified() {
            continue;
        }
        let combined_name = if raw.description.is_empty() {
            raw.friendly_name.clone()
        } else {
            format!("{} {}", raw.friendly_name, raw.description)
        };
        if is_virtual_interface_name(&combined_name) {
            continue;
        }
        match raw.ip {
            IpAddr::V4(v4) => {
                let oct = v4.octets();
                if oct[0] == 169 && oct[1] == 254 {
                    continue;
                }
                let addr_str = v4.to_string();
                if !san_entries.contains(&addr_str) {
                    san_entries.push(addr_str.clone());
                }
                let is_vpn = raw.is_tunnel_or_ppp
                    || is_vpn_interface(&combined_name, v4)
                    || (raw.is_virtual_iftype && !raw.has_gateway);
                if is_vpn {
                    vpn.push(NetworkEndpointInfo {
                        address: addr_str,
                        interface_name: raw.friendly_name,
                        kind: "vpn".to_owned(),
                    });
                } else {
                    if let Some(bcast) = directed_broadcast_for_v4(v4, raw.prefix_len)
                        && !broadcast_targets.contains(&bcast)
                    {
                        broadcast_targets.push(bcast);
                    }
                    physical.push((
                        raw.has_gateway,
                        raw.metric,
                        v4,
                        NetworkEndpointInfo {
                            address: addr_str,
                            interface_name: raw.friendly_name,
                            kind: "lan".to_owned(),
                        },
                    ));
                }
            }
            IpAddr::V6(v6) => {
                let seg = v6.segments()[0];
                if (seg & 0xfe00) == 0xfc00 {
                    let addr_str = v6.to_string();
                    if !san_entries.contains(&addr_str) {
                        san_entries.push(addr_str);
                    }
                }
            }
        }
    }

    broadcast_targets.push(Ipv4Addr::BROADCAST);

    physical.sort_by_key(|(has_gateway, metric, ip, _)| {
        let o = ip.octets();
        let rank = if o[0] == 192 && o[1] == 168 {
            0
        } else if o[0] == 10 {
            1
        } else if o[0] == 172 && (16..=31).contains(&o[1]) {
            2
        } else {
            3
        };
        (!has_gateway, rank, *metric, o)
    });

    let mut endpoints: Vec<NetworkEndpointInfo> =
        physical.into_iter().map(|(_, _, _, e)| e).collect();
    let primary_ip = endpoints
        .first()
        .map(|e| e.address.clone())
        .or_else(|| vpn.first().map(|e| e.address.clone()))
        .unwrap_or_else(|| "127.0.0.1".to_owned());

    endpoints.extend(vpn);

    NetworkDiscovery {
        primary_ip,
        endpoints,
        broadcast_targets,
        san_entries,
    }
}

pub fn detect_network_endpoints(hostname: &str) -> NetworkDiscovery {
    if let Some(raw_addrs) = collect_windows_adapter_addresses() {
        return build_network_discovery(hostname, raw_addrs);
    }

    let fallback = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .map(|(name, ip)| RawAdapterAddress {
            friendly_name: name,
            description: String::new(),
            ip,
            prefix_len: 0,
            has_gateway: true,
            metric: 100,
            is_tunnel_or_ppp: false,
            is_virtual_iftype: false,
        })
        .collect();
    build_network_discovery(hostname, fallback)
}

const RUN_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const AUTOSTART_VALUE_NAME: &str = "AetherRemote";

pub fn read_autostart_enabled() -> bool {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_SUBKEY) else {
        return false;
    };
    key.get_value::<String, _>(AUTOSTART_VALUE_NAME)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

pub fn write_autostart_enabled(enabled: bool) -> Result<(), String> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let (key, _) = hkcu.create_subkey(RUN_SUBKEY).map_err(|e| e.to_string())?;
        let cmd = format!("\"{}\"", exe.display());
        key.set_value(AUTOSTART_VALUE_NAME, &cmd)
            .map_err(|e| e.to_string())?;
    } else if let Ok(key) = hkcu.open_subkey_with_flags(RUN_SUBKEY, KEY_WRITE) {
        let _ = key.delete_value(AUTOSTART_VALUE_NAME);
    }
    Ok(())
}

#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn sync_autostart_path_if_enabled() {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_SUBKEY) else {
        return;
    };
    let Ok(existing) = key.get_value::<String, _>(AUTOSTART_VALUE_NAME) else {
        return;
    };
    let trimmed = existing.trim().trim_matches('"');
    if trimmed.is_empty() {
        return;
    }
    let expected = exe.to_string_lossy();
    if !trimmed.eq_ignore_ascii_case(&expected) {
        let _ = write_autostart_enabled(true);
    }
}

pub fn try_acquire_single_instance_or_focus() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SW_RESTORE, SW_SHOW, SetForegroundWindow, ShowWindow,
    };
    use windows::core::PCWSTR;
    use windows_sys::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    let mutex_name: Vec<u16> = OsStr::new("Local\\AetherRemoteHost_SingleInstance")
        .encode_wide()
        .chain(Some(0))
        .collect();
    unsafe {
        let handle = CreateMutexW(std::ptr::null(), 0, mutex_name.as_ptr());
        if !handle.is_null() && GetLastError() == ERROR_ALREADY_EXISTS {
            let title_w: Vec<u16> = OsStr::new("Aether Remote")
                .encode_wide()
                .chain(Some(0))
                .collect();
            if let Ok(hwnd) = FindWindowW(PCWSTR::null(), PCWSTR(title_w.as_ptr()))
                && !hwnd.is_invalid()
            {
                let _ = ShowWindow(hwnd, SW_SHOW);
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
            let _ = windows_sys::Win32::Foundation::CloseHandle(handle);
            return false;
        }
        // Keep handle open for process lifetime so Windows releases it cleanly on exit.
        let _ = handle;
    }
    true
}

pub fn sample_network_octets() -> Option<(u64, u64)> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
    };

    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table) != 0 || table.is_null() {
            return None;
        }
        let count = (*table).NumEntries as usize;
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), count);
        let mut rx: u64 = 0;
        let mut tx: u64 = 0;
        for row in rows {
            // Skip software loopback interfaces (IF_TYPE_SOFTWARE_LOOPBACK = 24)
            if row.Type == 24 || row.InterfaceAndOperStatusFlags._bitfield & 0x04 != 0 {
                continue;
            }
            rx = rx.saturating_add(row.InOctets);
            tx = tx.saturating_add(row.OutOctets);
        }
        FreeMibTable(table as *const _);
        Some((rx, tx))
    }
}

struct ComThreadGuard(bool);
impl Drop for ComThreadGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
}

fn init_com_mta() -> ComThreadGuard {
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    ComThreadGuard(hr.is_ok())
}

fn default_endpoint_volume() -> Result<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume, String> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender};
    use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator failed: {e}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("Audio endpoint unavailable: {e}"))?;
        device
            .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            .map_err(|e| format!("IAudioEndpointVolume unavailable: {e}"))
    }
}

pub fn get_system_audio_state() -> (u8, bool) {
    let _guard = init_com_mta();
    let Ok(vol) = default_endpoint_volume() else {
        return (50, false);
    };
    unsafe {
        let level = vol.GetMasterVolumeLevelScalar().unwrap_or(0.5);
        let muted = vol.GetMute().map(|b| b.as_bool()).unwrap_or(false);
        ((level.clamp(0.0, 1.0) * 100.0).round() as u8, muted)
    }
}

pub fn execute_core_audio_media(command: &str, value: Option<u8>) -> Result<Value, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
        VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
    };

    fn send_media_vk(vk: u16) {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: 0,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        unsafe {
            SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        }
    }

    match command {
        "VOL_SET" | "VOLUME_SET" => {
            let target = value.ok_or("volume value is required")?;
            let _guard = init_com_mta();
            let vol = default_endpoint_volume()?;
            let scalar = f32::from(target.min(100)) / 100.0;
            unsafe {
                vol.SetMasterVolumeLevelScalar(scalar, std::ptr::null())
                    .map_err(|e| format!("SetMasterVolumeLevelScalar failed: {e}"))?;
                if target > 0 {
                    let _ = vol.SetMute(false, std::ptr::null());
                }
            }
            let (new_vol, muted) = get_system_audio_state();
            Ok(json!({ "ok": true, "volume": new_vol, "isMuted": muted }))
        }
        "VOL_UP" => {
            let _guard = init_com_mta();
            let vol = default_endpoint_volume()?;
            let step = f32::from(value.unwrap_or(5).clamp(1, 25)) / 100.0;
            unsafe {
                let current = vol.GetMasterVolumeLevelScalar().unwrap_or(0.5);
                vol.SetMasterVolumeLevelScalar((current + step).clamp(0.0, 1.0), std::ptr::null())
                    .map_err(|e| format!("SetMasterVolumeLevelScalar failed: {e}"))?;
                let _ = vol.SetMute(false, std::ptr::null());
            }
            let (new_vol, muted) = get_system_audio_state();
            Ok(json!({ "ok": true, "volume": new_vol, "isMuted": muted }))
        }
        "VOL_DOWN" => {
            let _guard = init_com_mta();
            let vol = default_endpoint_volume()?;
            let step = f32::from(value.unwrap_or(5).clamp(1, 25)) / 100.0;
            unsafe {
                let current = vol.GetMasterVolumeLevelScalar().unwrap_or(0.5);
                vol.SetMasterVolumeLevelScalar((current - step).clamp(0.0, 1.0), std::ptr::null())
                    .map_err(|e| format!("SetMasterVolumeLevelScalar failed: {e}"))?;
            }
            let (new_vol, muted) = get_system_audio_state();
            Ok(json!({ "ok": true, "volume": new_vol, "isMuted": muted }))
        }
        "VOL_MUTE" => {
            let _guard = init_com_mta();
            let vol = default_endpoint_volume()?;
            unsafe {
                let current = vol.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                vol.SetMute(!current, std::ptr::null())
                    .map_err(|e| format!("SetMute failed: {e}"))?;
            }
            let (new_vol, muted) = get_system_audio_state();
            Ok(json!({ "ok": true, "volume": new_vol, "isMuted": muted }))
        }
        "PLAY_PAUSE" => {
            send_media_vk(VK_MEDIA_PLAY_PAUSE);
            Ok(json!({ "ok": true }))
        }
        "NEXT_TRACK" => {
            send_media_vk(VK_MEDIA_NEXT_TRACK);
            Ok(json!({ "ok": true }))
        }
        "PREV_TRACK" => {
            send_media_vk(VK_MEDIA_PREV_TRACK);
            Ok(json!({ "ok": true }))
        }
        _ => Err("unknown media command".to_owned()),
    }
}

pub fn read_current_media_session() -> (String, String, bool) {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };

    let _guard = init_com_mta();
    let Ok(op) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() else {
        return (String::new(), String::new(), false);
    };
    let Ok(mgr) = op.get() else {
        return (String::new(), String::new(), false);
    };
    let Ok(session) = mgr.GetCurrentSession() else {
        return (String::new(), String::new(), false);
    };
    let is_playing = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
        .is_some_and(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing);

    let (title, artist) = session
        .TryGetMediaPropertiesAsync()
        .ok()
        .and_then(|async_props| async_props.get().ok())
        .map(|props| {
            let t = props.Title().map(|s| s.to_string()).unwrap_or_default();
            let a = props.Artist().map(|s| s.to_string()).unwrap_or_default();
            (t, a)
        })
        .unwrap_or_default();

    (title, artist, is_playing)
}

pub fn open_native_folder_dialog(title: &str) -> Option<PathBuf> {
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH,
    };
    use windows::core::PCWSTR;

    let _ = COMDLG_FILTERSPEC::default();
    let title_w: Vec<u16> = OsStr::new(title).encode_wide().chain(Some(0)).collect();

    std::thread::spawn(move || unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> Option<PathBuf> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
            let opts = dialog.GetOptions().ok()?;
            dialog
                .SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
                .ok()?;
            let _ = dialog.SetTitle(PCWSTR(title_w.as_ptr()));
            if dialog.Show(None).is_err() {
                return None;
            }
            let item = dialog.GetResult().ok()?;
            let pwstr = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let path_str = pwstr.to_string().ok();
            CoTaskMemFree(Some(pwstr.0 as *const _));
            path_str.map(PathBuf::from)
        })();
        if hr.is_ok() {
            CoUninitialize();
        }
        result
    })
    .join()
    .ok()
    .flatten()
}

pub fn open_native_file_dialog(
    title: &str,
    filter_name: &str,
    filter_spec: &str,
) -> Option<PathBuf> {
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH,
    };
    use windows::core::PCWSTR;

    let title_w: Vec<u16> = OsStr::new(title).encode_wide().chain(Some(0)).collect();
    let name_w: Vec<u16> = OsStr::new(filter_name).encode_wide().chain(Some(0)).collect();
    let spec_w: Vec<u16> = OsStr::new(filter_spec).encode_wide().chain(Some(0)).collect();

    std::thread::spawn(move || unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> Option<PathBuf> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
            let opts = dialog.GetOptions().ok()?;
            dialog
                .SetOptions(opts | FOS_FILEMUSTEXIST | FOS_FORCEFILESYSTEM)
                .ok()?;
            let _ = dialog.SetTitle(PCWSTR(title_w.as_ptr()));
            let filters = [COMDLG_FILTERSPEC {
                pszName: PCWSTR(name_w.as_ptr()),
                pszSpec: PCWSTR(spec_w.as_ptr()),
            }];
            let _ = dialog.SetFileTypes(&filters);
            if dialog.Show(None).is_err() {
                return None;
            }
            let item = dialog.GetResult().ok()?;
            let pwstr = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let path_str = pwstr.to_string().ok();
            CoTaskMemFree(Some(pwstr.0 as *const _));
            path_str.map(PathBuf::from)
        })();
        if hr.is_ok() {
            CoUninitialize();
        }
        result
    })
    .join()
    .ok()
    .flatten()
}

pub fn open_native_save_dialog(
    title: &str,
    default_name: &str,
    filter_name: &str,
    filter_spec: &str,
) -> Option<PathBuf> {
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FOS_FORCEFILESYSTEM, FOS_OVERWRITEPROMPT, FileSaveDialog, IFileSaveDialog, SIGDN_FILESYSPATH,
    };
    use windows::core::PCWSTR;

    let title_w: Vec<u16> = OsStr::new(title).encode_wide().chain(Some(0)).collect();
    let default_w: Vec<u16> = OsStr::new(default_name).encode_wide().chain(Some(0)).collect();
    let name_w: Vec<u16> = OsStr::new(filter_name).encode_wide().chain(Some(0)).collect();
    let spec_w: Vec<u16> = OsStr::new(filter_spec).encode_wide().chain(Some(0)).collect();
    let ext_w: Vec<u16> = OsStr::new("aetherdeck").encode_wide().chain(Some(0)).collect();

    std::thread::spawn(move || unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> Option<PathBuf> {
            let dialog: IFileSaveDialog =
                CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER).ok()?;
            let opts = dialog.GetOptions().ok()?;
            dialog
                .SetOptions(opts | FOS_OVERWRITEPROMPT | FOS_FORCEFILESYSTEM)
                .ok()?;
            let _ = dialog.SetTitle(PCWSTR(title_w.as_ptr()));
            let _ = dialog.SetFileName(PCWSTR(default_w.as_ptr()));
            let _ = dialog.SetDefaultExtension(PCWSTR(ext_w.as_ptr()));
            let filters = [COMDLG_FILTERSPEC {
                pszName: PCWSTR(name_w.as_ptr()),
                pszSpec: PCWSTR(spec_w.as_ptr()),
            }];
            let _ = dialog.SetFileTypes(&filters);
            if dialog.Show(None).is_err() {
                return None;
            }
            let item = dialog.GetResult().ok()?;
            let pwstr = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let path_str = pwstr.to_string().ok();
            CoTaskMemFree(Some(pwstr.0 as *const _));
            path_str.map(PathBuf::from)
        })();
        if hr.is_ok() {
            CoUninitialize();
        }
        result
    })
    .join()
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::{
        RawAdapterAddress, build_network_discovery, detect_network_endpoints,
        directed_broadcast_for_v4,
    };
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn directed_broadcast_uses_real_prefix_length() {
        assert_eq!(
            directed_broadcast_for_v4(Ipv4Addr::new(192, 168, 31, 192), 24),
            Some(Ipv4Addr::new(192, 168, 31, 255))
        );
        assert_eq!(
            directed_broadcast_for_v4(Ipv4Addr::new(192, 168, 0, 50), 23),
            Some(Ipv4Addr::new(192, 168, 1, 255))
        );
        assert_eq!(
            directed_broadcast_for_v4(Ipv4Addr::new(172, 19, 0, 1), 30),
            Some(Ipv4Addr::new(172, 19, 0, 3))
        );
        assert_eq!(
            directed_broadcast_for_v4(Ipv4Addr::new(10, 0, 0, 1), 32),
            None
        );
    }

    #[test]
    fn virtual_and_vpn_adapters_do_not_hijack_primary_lan_ip() {
        let raw = vec![
            RawAdapterAddress {
                friendly_name: "slarp0".to_owned(),
                description: "Slarp Tunnel Adapter".to_owned(),
                ip: IpAddr::V4(Ipv4Addr::new(172, 19, 0, 1)),
                prefix_len: 30,
                has_gateway: false,
                metric: 5,
                is_tunnel_or_ppp: false,
                is_virtual_iftype: false,
            },
            RawAdapterAddress {
                friendly_name: "VirtualBox Host-Only Network".to_owned(),
                description: "Oracle VM VirtualBox Host-Only Ethernet Adapter".to_owned(),
                ip: IpAddr::V4(Ipv4Addr::new(192, 168, 56, 1)),
                prefix_len: 24,
                has_gateway: false,
                metric: 15,
                is_tunnel_or_ppp: false,
                is_virtual_iftype: false,
            },
            RawAdapterAddress {
                friendly_name: "Ethernet 2".to_owned(),
                description: "AmneziaWG Tunnel".to_owned(),
                ip: IpAddr::V4(Ipv4Addr::new(10, 8, 1, 2)),
                prefix_len: 24,
                has_gateway: true,
                metric: 10,
                is_tunnel_or_ppp: false,
                is_virtual_iftype: false,
            },
            RawAdapterAddress {
                friendly_name: "Wi-Fi".to_owned(),
                description: "Intel(R) Wi-Fi 6 AX201".to_owned(),
                ip: IpAddr::V4(Ipv4Addr::new(192, 168, 31, 192)),
                prefix_len: 24,
                has_gateway: true,
                metric: 35,
                is_tunnel_or_ppp: false,
                is_virtual_iftype: false,
            },
        ];

        let disc = build_network_discovery("DESKTOP-PC", raw);
        assert_eq!(disc.primary_ip, "192.168.31.192");
        assert!(
            disc.broadcast_targets
                .contains(&Ipv4Addr::new(192, 168, 31, 255))
        );
        assert!(
            !disc
                .broadcast_targets
                .contains(&Ipv4Addr::new(172, 19, 0, 3))
        );
        assert!(
            !disc
                .endpoints
                .iter()
                .any(|e| e.address == "172.19.0.1" && e.kind == "lan")
        );
        assert!(
            !disc
                .endpoints
                .iter()
                .any(|e| e.address == "10.8.1.2" && e.kind == "lan")
        );
        assert!(
            !disc
                .endpoints
                .iter()
                .any(|e| e.address == "192.168.56.1")
        );
    }

    #[test]
    fn live_windows_adapter_enumeration_excludes_slarp_from_lan() {
        let disc = detect_network_endpoints("TEST-HOST");
        assert!(!disc.primary_ip.is_empty());
        assert!(
            !disc
                .endpoints
                .iter()
                .any(|e| e.interface_name.to_ascii_lowercase().contains("slarp") && e.kind == "lan"),
            "slarp adapter must not be classified as physical LAN: {:?}",
            disc.endpoints
        );
    }
}
