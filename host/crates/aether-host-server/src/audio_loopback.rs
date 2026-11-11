use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AudioLoopbackHub {
    sender: broadcast::Sender<Vec<u8>>,
    state: Arc<Mutex<LoopbackState>>,
    init_lock: Arc<Mutex<()>>,
}

#[derive(Default)]
struct LoopbackState {
    listeners: usize,
    capture: Option<CaptureThreadHandle>,
}

struct CaptureThreadHandle {
    stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl Default for AudioLoopbackHub {
    fn default() -> Self {
        let (sender, _) = broadcast::channel(64);
        Self {
            sender,
            state: Arc::new(Mutex::new(LoopbackState::default())),
            init_lock: Arc::new(Mutex::new(())),
        }
    }
}

pub struct AudioSubscription {
    pub receiver: broadcast::Receiver<Vec<u8>>,
    hub: AudioLoopbackHub,
    active: bool,
}

impl Drop for AudioSubscription {
    fn drop(&mut self) {
        if self.active {
            self.hub.release_listener();
            self.active = false;
        }
    }
}

impl AudioLoopbackHub {
    pub async fn subscribe_async(&self) -> Result<AudioSubscription, String> {
        let hub = self.clone();
        tokio::task::spawn_blocking(move || hub.subscribe())
            .await
            .map_err(|e| format!("Audio task join error: {e}"))?
    }

    pub fn subscribe(&self) -> Result<AudioSubscription, String> {
        // Serialize initialization outside `state` so concurrent `release_listener`
        // calls never stall waiting up to 3 seconds on WASAPI thread startup.
        let _init_guard = self
            .init_lock
            .lock()
            .map_err(|_| "audio init lock unavailable".to_owned())?;
        let receiver = self.sender.subscribe();
        let need_start = {
            let guard = self
                .state
                .lock()
                .map_err(|_| "audio lock unavailable".to_owned())?;
            guard
                .capture
                .as_ref()
                .is_none_or(|c| c.stop.load(Ordering::Acquire))
        };
        let started_handle = if need_start {
            #[cfg(target_os = "windows")]
            {
                Some(Self::start_capture_thread(self.sender.clone())?)
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err("WASAPI loopback audio requires Windows".to_owned());
            }
        } else {
            None
        };
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "audio lock unavailable".to_owned())?;
        if let Some(handle) = started_handle {
            guard.capture = Some(handle);
        }
        guard.listeners += 1;
        Ok(AudioSubscription {
            receiver,
            hub: self.clone(),
            active: true,
        })
    }

    fn release_listener(&self) {
        let to_join = if let Ok(mut guard) = self.state.lock() {
            guard.listeners = guard.listeners.saturating_sub(1);
            if guard.listeners == 0 {
                if let Some(mut handle) = guard.capture.take() {
                    handle.stop.store(true, Ordering::Release);
                    handle.join.take()
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        if let Some(join) = to_join {
            let _ = std::thread::Builder::new()
                .name("aether-wasapi-join".into())
                .spawn(move || {
                    let _ = join.join();
                });
        }
    }

    #[cfg(target_os = "windows")]
    fn start_capture_thread(sender: broadcast::Sender<Vec<u8>>) -> Result<CaptureThreadHandle, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let (init_tx, init_rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);

        let join = std::thread::Builder::new()
            .name("aether-wasapi-loopback".into())
            .spawn(move || {
                run_wasapi_loopback(stop_thread, sender, init_tx);
            })
            .map_err(|e| format!("Failed to spawn audio thread: {e}"))?;

        match init_rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(CaptureThreadHandle {
                stop,
                join: Some(join),
            }),
            Ok(Err(err)) => {
                stop.store(true, Ordering::Release);
                let _ = join.join();
                Err(err)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                Err("Timed out initializing WASAPI loopback".to_owned())
            }
        }
    }
}

#[cfg(target_os = "windows")]
struct ComGuard(bool);

#[cfg(target_os = "windows")]
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn run_wasapi_loopback(
    stop: Arc<AtomicBool>,
    sender: broadcast::Sender<Vec<u8>>,
    init_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
) {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let _com_guard = ComGuard(hr.is_ok());

    let res: Result<(IAudioClient, IAudioCaptureClient, bool, u32, u16, u16, bool), String> =
        (|| unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("MMDeviceEnumerator failed: {e}"))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("Default render audio endpoint unavailable: {e}"))?;
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("IAudioClient activate failed: {e}"))?;

            let desired = WAVEFORMATEX {
                wFormatTag: 1, // WAVE_FORMAT_PCM
                nChannels: 2,
                nSamplesPerSec: 44100,
                nAvgBytesPerSec: 44100 * 4,
                nBlockAlign: 4,
                wBitsPerSample: 16,
                cbSize: 0,
            };

            let buffer_duration_hns = 2_000_000_i64; // 200ms
            let flags_auto = AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

            let (converted, sample_rate, channels, bits, is_float) = if client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    flags_auto,
                    buffer_duration_hns,
                    0,
                    &desired,
                    None,
                )
                .is_ok()
            {
                (true, 44100_u32, 2_u16, 16_u16, false)
            } else {
                let mix_ptr = client
                    .GetMixFormat()
                    .map_err(|e| format!("GetMixFormat failed: {e}"))?;
                let mix = *mix_ptr;
                let sr = mix.nSamplesPerSec.max(8000);
                let ch = mix.nChannels.max(1);
                let b = mix.wBitsPerSample;
                // WAVE_FORMAT_IEEE_FLOAT (3) or WAVE_FORMAT_EXTENSIBLE (0xFFFE)
                let float_fmt = mix.wFormatTag == 3 || (mix.wFormatTag == 0xFFFE && b == 32);
                let init_native = client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    buffer_duration_hns,
                    0,
                    mix_ptr,
                    None,
                );
                CoTaskMemFree(Some(mix_ptr as *const _));
                init_native.map_err(|e| format!("WASAPI Initialize failed: {e}"))?;
                (false, sr, ch, b, float_fmt)
            };

            let capture: IAudioCaptureClient = client
                .GetService()
                .map_err(|e| format!("IAudioCaptureClient failed: {e}"))?;
            client
                .Start()
                .map_err(|e| format!("IAudioClient Start failed: {e}"))?;

            Ok((client, capture, converted, sample_rate, channels, bits, is_float))
        })();

    let (client, capture, converted, src_rate, src_channels, src_bits, is_float) = match res {
        Ok(tuple) => {
            let _ = init_tx.send(Ok(()));
            tuple
        }
        Err(err) => {
            let _ = init_tx.send(Err(err));
            return;
        }
    };

    const CHUNK_BYTES: usize = 4096 * 2; // ~46ms of 44.1kHz stereo PCM16
    let mut accum: Vec<u8> = Vec::with_capacity(CHUNK_BYTES + 2048);
    let mut resample_phase = 0.0_f64;

    while !stop.load(Ordering::Acquire) {
        std::thread::sleep(std::time::Duration::from_millis(12));
        loop {
            let next_packet = match unsafe { capture.GetNextPacketSize() } {
                Ok(n) => n,
                Err(_) => break,
            };
            if next_packet == 0 {
                break;
            }
            let mut data_ptr: *mut u8 = std::ptr::null_mut();
            let mut frames: u32 = 0;
            let mut flags: u32 = 0;
            if unsafe { capture.GetBuffer(&mut data_ptr, &mut frames, &mut flags, None, None) }.is_err()
            {
                break;
            }
            let silent = (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0 || data_ptr.is_null();
            if frames > 0 {
                if silent {
                    let out_frames = if converted {
                        frames as usize
                    } else {
                        ((frames as usize) * 44100) / (src_rate as usize).max(1)
                    };
                    let add_bytes = out_frames * 4;
                    accum.resize(accum.len() + add_bytes, 0);
                } else if converted {
                    let slice = unsafe { std::slice::from_raw_parts(data_ptr, frames as usize * 4) };
                    accum.extend_from_slice(slice);
                } else {
                    unsafe {
                        convert_to_44100_stereo_i16(
                            data_ptr,
                            frames as usize,
                            src_rate,
                            src_channels,
                            src_bits,
                            is_float,
                            &mut resample_phase,
                            &mut accum,
                        );
                    }
                }
            }
            let _ = unsafe { capture.ReleaseBuffer(frames) };

            while accum.len() >= CHUNK_BYTES {
                let chunk: Vec<u8> = accum.drain(..CHUNK_BYTES).collect();
                let mut packet = Vec::with_capacity(1 + chunk.len());
                packet.push(0x02);
                packet.extend_from_slice(&chunk);
                let _ = sender.send(packet);
            }
        }
    }

    let _ = unsafe { client.Stop() };
}

#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)]
unsafe fn convert_to_44100_stereo_i16(
    data_ptr: *const u8,
    frames: usize,
    src_rate: u32,
    src_channels: u16,
    src_bits: u16,
    is_float: bool,
    phase: &mut f64,
    out: &mut Vec<u8>,
) {
    let ch = src_channels as usize;
    let bytes_per_sample = (src_bits as usize / 8).max(1);
    let stride = ch * bytes_per_sample;
    let raw = unsafe { std::slice::from_raw_parts(data_ptr, frames * stride) };

    let read_sample = |frame_idx: usize, channel_idx: usize| -> i16 {
        let c = channel_idx.min(ch - 1);
        let offset = frame_idx * stride + c * bytes_per_sample;
        if is_float && bytes_per_sample == 4 {
            let val = f32::from_le_bytes(raw[offset..offset + 4].try_into().unwrap_or([0; 4]));
            (val.clamp(-1.0, 1.0) * 32767.0) as i16
        } else if bytes_per_sample == 2 {
            i16::from_le_bytes(raw[offset..offset + 2].try_into().unwrap_or([0; 2]))
        } else {
            0
        }
    };

    if src_rate == 44100 {
        for i in 0..frames {
            let l = read_sample(i, 0);
            let r = if ch > 1 { read_sample(i, 1) } else { l };
            out.extend_from_slice(&l.to_le_bytes());
            out.extend_from_slice(&r.to_le_bytes());
        }
        *phase = 0.0;
        return;
    }

    let step = src_rate as f64 / 44100.0;
    let mut pos = *phase;
    while (pos as usize) < frames {
        let i = pos as usize;
        let l = read_sample(i, 0);
        let r = if ch > 1 { read_sample(i, 1) } else { l };
        out.extend_from_slice(&l.to_le_bytes());
        out.extend_from_slice(&r.to_le_bytes());
        pos += step;
    }
    *phase = pos - frames as f64;
}
