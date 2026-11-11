#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use serde_json::{Value, json};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy)]
pub struct MonitorRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub primary: bool,
}

impl MonitorRect {
    pub fn width(self) -> i32 {
        (self.right - self.left).max(1)
    }

    pub fn height(self) -> i32 {
        (self.bottom - self.top).max(1)
    }
}

#[cfg(target_os = "windows")]
pub fn enumerate_monitors() -> Vec<MonitorRect> {
    use windows_sys::Win32::Foundation::{LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, MONITORINFOF_PRIMARY, SM_CXSCREEN, SM_CYSCREEN,
    };

    unsafe extern "system" fn callback(
        monitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        data: LPARAM,
    ) -> i32 {
        let out = unsafe { &mut *(data as *mut Vec<MonitorRect>) };
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe { GetMonitorInfoW(monitor, &mut info) } != 0 {
            out.push(MonitorRect {
                left: info.rcMonitor.left,
                top: info.rcMonitor.top,
                right: info.rcMonitor.right,
                bottom: info.rcMonitor.bottom,
                primary: (info.dwFlags & MONITORINFOF_PRIMARY) != 0,
            });
        }
        1
    }

    let mut monitors: Vec<MonitorRect> = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(callback),
            &mut monitors as *mut Vec<MonitorRect> as LPARAM,
        );
    }
    if monitors.is_empty() {
        let w = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1);
        let h = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1);
        monitors.push(MonitorRect {
            left: 0,
            top: 0,
            right: w,
            bottom: h,
            primary: true,
        });
    } else {
        monitors.sort_by_key(|m| (!m.primary, m.left, m.top));
    }
    monitors
}

#[cfg(not(target_os = "windows"))]
pub fn enumerate_monitors() -> Vec<MonitorRect> {
    vec![MonitorRect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
        primary: true,
    }]
}

pub fn monitors_count() -> usize {
    enumerate_monitors().len().max(1)
}

#[cfg(target_os = "windows")]
pub fn capture_screen_jpeg_for_monitor(
    quality: u8,
    monitor_index: usize,
    max_width: Option<u32>,
) -> Result<(Vec<u8>, u32, u32, usize), String> {
    use windows_sys::Win32::Graphics::Gdi::*;

    let monitors = enumerate_monitors();
    let total = monitors.len();
    let mon = monitors[monitor_index.min(total - 1)];
    let src_w = mon.width();
    let src_h = mon.height();

    unsafe {
        let hdc_screen = GetDC(std::ptr::null_mut());
        if hdc_screen.is_null() {
            return Err("GetDC failed".to_string());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("CreateCompatibleDC failed".to_string());
        }
        let hbm = CreateCompatibleBitmap(hdc_screen, src_w, src_h);
        if hbm.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("CreateCompatibleBitmap failed".to_string());
        }

        let old_obj = SelectObject(hdc_mem, hbm);
        let blt_res = BitBlt(
            hdc_mem,
            0,
            0,
            src_w,
            src_h,
            hdc_screen,
            mon.left,
            mon.top,
            SRCCOPY | CAPTUREBLT,
        );
        if blt_res == 0 {
            SelectObject(hdc_mem, old_obj);
            DeleteObject(hbm);
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("BitBlt failed".to_string());
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = src_w;
        bmi.bmiHeader.biHeight = -src_h;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let mut raw_pixels = vec![0u8; (src_w as usize) * (src_h as usize) * 4];
        let dib_res = GetDIBits(
            hdc_mem,
            hbm,
            0,
            src_h as u32,
            raw_pixels.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        SelectObject(hdc_mem, old_obj);
        DeleteObject(hbm);
        DeleteDC(hdc_mem);
        ReleaseDC(std::ptr::null_mut(), hdc_screen);

        if dib_res == 0 {
            return Err("GetDIBits failed".to_string());
        }

        let w_u32 = src_w as u32;
        let h_u32 = src_h as u32;
        let (out_w, out_h, rgb_pixels) = if let Some(limit_w) = max_width
            && w_u32 > limit_w
            && limit_w >= 160
        {
            let target_w = limit_w;
            let target_h = ((h_u32 as u64 * target_w as u64) / w_u32 as u64).max(1) as u32;
            let mut down = Vec::with_capacity((target_w as usize) * (target_h as usize) * 3);
            for y in 0..target_h {
                let sy = ((y as u64 * h_u32 as u64) / target_h as u64) as usize;
                let row_off = sy * (w_u32 as usize);
                for x in 0..target_w {
                    let sx = ((x as u64 * w_u32 as u64) / target_w as u64) as usize;
                    let idx = (row_off + sx) * 4;
                    down.push(raw_pixels[idx + 2]);
                    down.push(raw_pixels[idx + 1]);
                    down.push(raw_pixels[idx]);
                }
            }
            (target_w, target_h, down)
        } else {
            let mut rgb = Vec::with_capacity((w_u32 as usize) * (h_u32 as usize) * 3);
            for chunk in raw_pixels.chunks_exact(4) {
                rgb.push(chunk[2]);
                rgb.push(chunk[1]);
                rgb.push(chunk[0]);
            }
            (w_u32, h_u32, rgb)
        };

        let mut jpeg_buf = Vec::with_capacity(64 * 1024);
        let mut encoder =
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, quality.clamp(10, 100));
        encoder
            .encode(
                &rgb_pixels,
                out_w,
                out_h,
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| format!("JPEG encode failed: {e}"))?;

        Ok((jpeg_buf, out_w, out_h, total))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_screen_jpeg_for_monitor(
    _quality: u8,
    _monitor_index: usize,
    _max_width: Option<u32>,
) -> Result<(Vec<u8>, u32, u32, usize), String> {
    Err("Screen capture is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
pub fn handle_mouse_move(dx: i32, dy: i32) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_MOVE, MOUSEINPUT, SendInput,
    };
    if dx == 0 && dy == 0 {
        return;
    }
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: dx.clamp(-5000, 5000),
                dy: dy.clamp(-5000, 5000),
                mouseData: 0,
                dwFlags: MOUSEEVENTF_MOVE,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        SendInput(1, &input, std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn handle_mouse_move(_dx: i32, _dy: i32) {}

#[cfg(target_os = "windows")]
pub fn handle_mouse_click(button: &str) {
    handle_mouse_click_at(button, None, None, 0);
}

#[cfg(not(target_os = "windows"))]
pub fn handle_mouse_click(_button: &str) {}

#[cfg(target_os = "windows")]
pub fn handle_mouse_click_at(
    button: &str,
    norm_x: Option<f64>,
    norm_y: Option<f64>,
    monitor_index: usize,
) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;

    if let (Some(nx), Some(ny)) = (norm_x, norm_y)
        && nx.is_finite()
        && ny.is_finite()
    {
        let monitors = enumerate_monitors();
        if let Some(mon) = monitors.get(monitor_index).or_else(|| monitors.first()) {
            let cx = nx.clamp(0.0, 1.0);
            let cy = ny.clamp(0.0, 1.0);
            let target_x = mon.left + (cx * (mon.width() - 1).max(1) as f64).round() as i32;
            let target_y = mon.top + (cy * (mon.height() - 1).max(1) as f64).round() as i32;
            unsafe {
                SetCursorPos(target_x, target_y);
            }
        }
    }

    let mouse_ev = |flags: MOUSE_EVENT_FLAGS| INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = match button.to_ascii_lowercase().as_str() {
        "right" => vec![mouse_ev(MOUSEEVENTF_RIGHTDOWN), mouse_ev(MOUSEEVENTF_RIGHTUP)],
        "middle" => vec![mouse_ev(MOUSEEVENTF_MIDDLEDOWN), mouse_ev(MOUSEEVENTF_MIDDLEUP)],
        "double" => vec![
            mouse_ev(MOUSEEVENTF_LEFTDOWN),
            mouse_ev(MOUSEEVENTF_LEFTUP),
            mouse_ev(MOUSEEVENTF_LEFTDOWN),
            mouse_ev(MOUSEEVENTF_LEFTUP),
        ],
        _ => vec![mouse_ev(MOUSEEVENTF_LEFTDOWN), mouse_ev(MOUSEEVENTF_LEFTUP)],
    };
    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn handle_mouse_click_at(
    _button: &str,
    _norm_x: Option<f64>,
    _norm_y: Option<f64>,
    _monitor_index: usize,
) {
}

#[cfg(target_os = "windows")]
pub fn handle_mouse_scroll(dy: i32, dx: i32) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let mut inputs = Vec::new();
    if dy != 0 {
        let delta = (dy.clamp(-100, 100) * 120) as u32;
        inputs.push(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: delta,
                    dwFlags: MOUSEEVENTF_WHEEL,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }
    if dx != 0 {
        let delta = (dx.clamp(-100, 100) * 120) as u32;
        inputs.push(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: delta,
                    dwFlags: MOUSEEVENTF_HWHEEL,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }
    if !inputs.is_empty() {
        unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn handle_mouse_scroll(_dy: i32, _dx: i32) {}

#[cfg(target_os = "windows")]
fn named_vk(key: &str) -> Option<(u16, bool)> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let upper = key
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .to_ascii_uppercase();
    let res = match upper.as_str() {
        "ENTER" | "RETURN" => (VK_RETURN, false),
        "BACK" | "BACKSPACE" => (VK_BACK, false),
        "TAB" => (VK_TAB, false),
        "ESC" | "ESCAPE" => (VK_ESCAPE, false),
        "SPACE" | "SPACEBAR" => (VK_SPACE, false),
        "UP" => (VK_UP, true),
        "DOWN" => (VK_DOWN, true),
        "LEFT" => (VK_LEFT, true),
        "RIGHT" => (VK_RIGHT, true),
        "DELETE" | "DEL" => (VK_DELETE, true),
        "INSERT" | "INS" => (VK_INSERT, true),
        "HOME" => (VK_HOME, true),
        "END" => (VK_END, true),
        "PAGEUP" | "PAGE_UP" | "PGUP" | "PRIOR" => (VK_PRIOR, true),
        "PAGEDOWN" | "PAGE_DOWN" | "PGDN" | "NEXT" => (VK_NEXT, true),
        "WIN" | "LWIN" | "WINDOWS" | "META" | "SUPER" => (VK_LWIN, true),
        "RWIN" => (VK_RWIN, true),
        "CTRL" | "CONTROL" | "LCTRL" => (VK_CONTROL, false),
        "RCTRL" => (VK_RCONTROL, true),
        "ALT" | "MENU" | "LALT" => (VK_MENU, false),
        "RALT" => (VK_RMENU, true),
        "SHIFT" | "LSHIFT" => (VK_SHIFT, false),
        "RSHIFT" => (VK_RSHIFT, false),
        "CAPSLOCK" | "CAPS_LOCK" => (VK_CAPITAL, false),
        "PRINTSCREEN" | "PRINT_SCREEN" | "SNAPSHOT" => (VK_SNAPSHOT, true),
        "VOLUME_UP" | "VOL_UP" => (VK_VOLUME_UP, false),
        "VOLUME_DOWN" | "VOL_DOWN" => (VK_VOLUME_DOWN, false),
        "VOLUME_MUTE" | "VOL_MUTE" | "MUTE" => (VK_VOLUME_MUTE, false),
        "MEDIA_PLAY_PAUSE" | "PLAY_PAUSE" => (VK_MEDIA_PLAY_PAUSE, false),
        "MEDIA_NEXT" | "MEDIA_NEXT_TRACK" | "NEXT_TRACK" => (VK_MEDIA_NEXT_TRACK, false),
        "MEDIA_PREV" | "MEDIA_PREVIOUS" | "MEDIA_PREV_TRACK" | "PREV_TRACK" => (VK_MEDIA_PREV_TRACK, false),
        "MEDIA_STOP" => (VK_MEDIA_STOP, false),
        "F1" => (VK_F1, false),
        "F2" => (VK_F2, false),
        "F3" => (VK_F3, false),
        "F4" => (VK_F4, false),
        "F5" => (VK_F5, false),
        "F6" => (VK_F6, false),
        "F7" => (VK_F7, false),
        "F8" => (VK_F8, false),
        "F9" => (VK_F9, false),
        "F10" => (VK_F10, false),
        "F11" => (VK_F11, false),
        "F12" => (VK_F12, false),
        "F13" => (VK_F13, false),
        "F14" => (VK_F14, false),
        "F15" => (VK_F15, false),
        "F16" => (VK_F16, false),
        "F17" => (VK_F17, false),
        "F18" => (VK_F18, false),
        "F19" => (VK_F19, false),
        "F20" => (VK_F20, false),
        "F21" => (VK_F21, false),
        "F22" => (VK_F22, false),
        "F23" => (VK_F23, false),
        "F24" => (VK_F24, false),
        _ if upper.len() == 1 => {
            let b = upper.as_bytes()[0];
            if b.is_ascii_alphanumeric() {
                (u16::from(b), false)
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some(res)
}

#[cfg(target_os = "windows")]
fn kb_input(vk: u16, scan: u16, flags: u32) -> windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

#[cfg(target_os = "windows")]
pub fn send_hotkey_vks(keys: &[String]) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, SendInput, INPUT};
    let resolved: Vec<(u16, bool)> = keys.iter().filter_map(|k| named_vk(k)).collect();
    if resolved.is_empty() {
        return;
    }
    let mut inputs = Vec::with_capacity(resolved.len() * 2);
    for &(vk, ext) in &resolved {
        let flags = if ext { KEYEVENTF_EXTENDEDKEY } else { 0 };
        inputs.push(kb_input(vk, 0, flags));
    }
    for &(vk, ext) in resolved.iter().rev() {
        let flags = KEYEVENTF_KEYUP | if ext { KEYEVENTF_EXTENDEDKEY } else { 0 };
        inputs.push(kb_input(vk, 0, flags));
    }
    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn send_hotkey_vks(_keys: &[String]) {}

#[cfg(target_os = "windows")]
pub fn send_unicode_text(text: &str) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput,
    };
    let units: Vec<u16> = text.chars().take(10_000).collect::<String>().encode_utf16().collect();
    if units.is_empty() {
        return;
    }
    let mut inputs = Vec::with_capacity(units.len() * 2);
    for unit in units {
        inputs.push(kb_input(0, unit, KEYEVENTF_UNICODE));
        inputs.push(kb_input(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }
    unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn send_unicode_text(_text: &str) {}

#[cfg(target_os = "windows")]
pub fn handle_key_press_full(text: Option<&str>, vk: Option<u16>, modifiers: &[String]) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;

    if let Some(vk_code) = vk {
        let is_ext = matches!(
            vk_code,
            VK_UP | VK_DOWN | VK_LEFT | VK_RIGHT | VK_HOME | VK_END | VK_PRIOR | VK_NEXT | VK_INSERT | VK_DELETE | VK_LWIN | VK_RWIN | VK_APPS
        );
        let mod_vks: Vec<(u16, bool)> = modifiers.iter().filter_map(|m| named_vk(m)).collect();
        let mut inputs = Vec::with_capacity(mod_vks.len() * 2 + 2);
        for &(m_vk, m_ext) in &mod_vks {
            inputs.push(kb_input(m_vk, 0, if m_ext { KEYEVENTF_EXTENDEDKEY } else { 0 }));
        }
        let base_flags = if is_ext { KEYEVENTF_EXTENDEDKEY } else { 0 };
        inputs.push(kb_input(vk_code, 0, base_flags));
        inputs.push(kb_input(vk_code, 0, base_flags | KEYEVENTF_KEYUP));
        for &(m_vk, m_ext) in mod_vks.iter().rev() {
            inputs.push(kb_input(
                m_vk,
                0,
                KEYEVENTF_KEYUP | if m_ext { KEYEVENTF_EXTENDEDKEY } else { 0 },
            ));
        }
        unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
        return;
    }

    let Some(raw) = text else { return };
    if raw.is_empty() {
        return;
    }

    if raw.contains('+') && raw.len() > 1 && !raw.starts_with('+') {
        let parts: Vec<String> = raw.split('+').map(|s| s.trim().to_owned()).collect();
        if parts.len() >= 2 && parts.iter().all(|p| named_vk(p).is_some()) {
            send_hotkey_vks(&parts);
            return;
        }
    }

    if modifiers.is_empty() {
        if let Some((single_vk, ext)) = named_vk(raw) {
            // Single printable ASCII characters use KEYEVENTF_UNICODE when no modifier is held so layout matches mobile input.
            if raw.chars().count() == 1 && raw.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
                send_unicode_text(raw);
            } else {
                let flags = if ext { KEYEVENTF_EXTENDEDKEY } else { 0 };
                let inputs = [
                    kb_input(single_vk, 0, flags),
                    kb_input(single_vk, 0, flags | KEYEVENTF_KEYUP),
                ];
                unsafe {
                    SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
                }
            }
            return;
        }
        send_unicode_text(raw);
    } else if let Some((single_vk, ext)) = named_vk(raw) {
        let mut combined = modifiers.to_vec();
        combined.push(raw.to_owned());
        let _ = (single_vk, ext);
        send_hotkey_vks(&combined);
    } else {
        send_unicode_text(raw);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn handle_key_press_full(_text: Option<&str>, _vk: Option<u16>, _modifiers: &[String]) {}

#[cfg(target_os = "windows")]
pub fn handle_power_action(command: &str) -> Value {
    use windows_sys::Win32::System::Power::SetSuspendState;
    use windows_sys::Win32::System::Shutdown::LockWorkStation;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, PostMessageW, WM_CLOSE};

    match command {
        "SHUTDOWN" | "POWER_SHUTDOWN" => {
            match std::process::Command::new("shutdown.exe")
                .args(["/s", "/t", "0"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
            {
                Ok(_) => json!({"action": "POWER_RESPONSE", "status": "SUCCESS", "command": command}),
                Err(err) => json!({"action": "POWER_RESPONSE", "status": "ERROR", "error": err.to_string(), "command": command}),
            }
        }
        "REBOOT" | "POWER_REBOOT" | "RESTART" => {
            match std::process::Command::new("shutdown.exe")
                .args(["/r", "/t", "0"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
            {
                Ok(_) => json!({"action": "POWER_RESPONSE", "status": "SUCCESS", "command": command}),
                Err(err) => json!({"action": "POWER_RESPONSE", "status": "ERROR", "error": err.to_string(), "command": command}),
            }
        }
        "LOCK" | "POWER_LOCK" => {
            let ok = unsafe { LockWorkStation() != 0 };
            if ok {
                json!({"action": "POWER_RESPONSE", "status": "SUCCESS", "command": command})
            } else {
                json!({"action": "POWER_RESPONSE", "status": "ERROR", "error": "LockWorkStation failed", "command": command})
            }
        }
        "SLEEP" | "POWER_SLEEP" => {
            // hibernate = false, forceCritical = false, disableWakeEvent = false
            let ok = unsafe { SetSuspendState(false, false, false) };
            if ok {
                json!({"action": "POWER_RESPONSE", "status": "SUCCESS", "command": command})
            } else {
                json!({"action": "POWER_RESPONSE", "status": "ERROR", "error": "SetSuspendState failed", "command": command})
            }
        }
        "ALT_F4" | "CLOSE_WINDOW" => {
            let hwnd = unsafe { GetForegroundWindow() };
            if !hwnd.is_null() {
                unsafe {
                    PostMessageW(hwnd, WM_CLOSE, 0, 0);
                }
            }
            json!({"action": "POWER_RESPONSE", "status": "SUCCESS", "command": command})
        }
        _ => json!({"action": "POWER_RESPONSE", "status": "ERROR", "error": "Unknown power command"}),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn handle_power_action(command: &str) -> Value {
    json!({"action": "POWER_RESPONSE", "status": "ERROR", "error": "Power commands require Windows", "command": command})
}

const CRITICAL_PROCESSES: &[&str] = &[
    "csrss", "explorer", "lsass", "smss", "services", "winlogon", "svchost", "system", "conhost",
    "init",
];

#[cfg(target_os = "windows")]
pub fn handle_kill_process(name: &str) -> Value {
    let trimmed = name.trim();
    let is_safe = !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');
    if !is_safe {
        return json!({"action": "KILL_PROCESS_RESPONSE", "status": "ERROR", "error": "Invalid process name"});
    }
    let stem = trimmed
        .to_ascii_lowercase()
        .trim_end_matches(".exe")
        .to_owned();
    if CRITICAL_PROCESSES.contains(&stem.as_str()) {
        return json!({
            "action": "KILL_PROCESS_RESPONSE",
            "status": "ERROR",
            "error": format!("Cannot terminate critical Windows process '{trimmed}'")
        });
    }
    let is_pid = trimmed.bytes().all(|b| b.is_ascii_digit());
    if is_pid {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
        };
        let Ok(pid) = trimmed.parse::<u32>() else {
            return json!({"action": "KILL_PROCESS_RESPONSE", "status": "ERROR", "error": "Invalid PID"});
        };
        if pid <= 4 {
            return json!({
                "action": "KILL_PROCESS_RESPONSE",
                "status": "ERROR",
                "error": format!("Cannot terminate protected Windows PID '{trimmed}'")
            });
        }
        let image_stem = unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                None
            } else {
                let mut buf = [0u16; 1024];
                let mut size = buf.len() as u32;
                let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
                CloseHandle(handle);
                if ok != 0 && size > 0 {
                    let full = String::from_utf16_lossy(&buf[..size as usize]);
                    std::path::Path::new(&full)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_ascii_lowercase())
                } else {
                    None
                }
            }
        };
        if let Some(ref resolved) = image_stem
            && CRITICAL_PROCESSES.contains(&resolved.as_str())
        {
            return json!({
                "action": "KILL_PROCESS_RESPONSE",
                "status": "ERROR",
                "error": format!("Cannot terminate critical Windows process '{resolved}' (PID {trimmed})")
            });
        }
    }
    let output = if is_pid {
        std::process::Command::new("taskkill.exe")
            .args(["/F", "/PID", trimmed])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    } else {
        let image = format!("{stem}.exe");
        std::process::Command::new("taskkill.exe")
            .args(["/F", "/IM", &image])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };
    match output {
        Ok(res) if res.status.success() => {
            json!({"action": "KILL_PROCESS_RESPONSE", "status": "SUCCESS", "process": trimmed})
        }
        Ok(_) => {
            json!({"action": "KILL_PROCESS_RESPONSE", "status": "ERROR", "error": format!("Failed to terminate process {trimmed}")})
        }
        Err(err) => {
            json!({"action": "KILL_PROCESS_RESPONSE", "status": "ERROR", "error": err.to_string()})
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn handle_kill_process(name: &str) -> Value {
    json!({"action": "KILL_PROCESS_RESPONSE", "status": "ERROR", "error": format!("Not supported on this OS: {name}")})
}

#[cfg(target_os = "windows")]
pub fn window_command(command: &str) -> Result<(), String> {
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Err("No active foreground window".to_owned());
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == GetCurrentProcessId() {
            return Err("Refusing to manipulate host control window".to_owned());
        }
        match command {
            "minimize" => {
                ShowWindow(hwnd, SW_MINIMIZE);
            }
            "maximize" => {
                ShowWindow(hwnd, SW_MAXIMIZE);
            }
            "restore" => {
                ShowWindow(hwnd, SW_RESTORE);
            }
            "close" => {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
            _ => return Err("Unsupported window command".to_owned()),
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn window_command(_command: &str) -> Result<(), String> {
    Err("Window control requires Windows".to_owned())
}

#[cfg(target_os = "windows")]
struct ScopedCom(bool);

#[cfg(target_os = "windows")]
impl Drop for ScopedCom {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn shell_open_target(target: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::System::Com::{
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
    let _com_guard = ScopedCom(hr.is_ok());

    let verb: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
    let file: Vec<u16> = OsStr::new(target).encode_wide().chain(Some(0)).collect();
    let handle = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (handle as usize) <= 32 {
        return Err(format!("Failed to open target (ShellExecute code {})", handle as usize));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn shell_open_target(_target: &str) -> Result<(), String> {
    Err("Shell open requires Windows".to_owned())
}

#[cfg(target_os = "windows")]
pub fn reveal_in_explorer(path: &str) -> Result<(), String> {
    let normalized = if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        path.to_owned()
    };
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{normalized}"))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn reveal_in_explorer(_path: &str) -> Result<(), String> {
    Err("Explorer reveal requires Windows".to_owned())
}

#[cfg(target_os = "windows")]
pub fn show_windows_toast(title: &str, message: &str) {
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
    use windows::core::HSTRING;

    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let _com_guard = ScopedCom(hr.is_ok());

    fn escape_xml(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        for ch in input.chars().take(1000) {
            match ch {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                '"' => out.push_str("&quot;"),
                '\'' => out.push_str("&apos;"),
                c if !c.is_control() || c == '\n' => out.push(c),
                _ => {}
            }
        }
        out
    }

    let xml_body = format!(
        r#"<toast><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>"#,
        escape_xml(title),
        escape_xml(message)
    );
    if let Ok(doc) = XmlDocument::new()
        && doc.LoadXml(&HSTRING::from(xml_body)).is_ok()
        && let Ok(toast) = ToastNotification::CreateToastNotification(&doc)
        && let Ok(notifier) =
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.aether.remotehost"))
    {
        let _ = notifier.Show(&toast);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn show_windows_toast(_title: &str, _message: &str) {}
