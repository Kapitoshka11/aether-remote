use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, oneshot};
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

use crate::{ApprovalGate, PairingRequest, win_input};

#[async_trait]
pub trait DeckExecutor: Send + Sync + 'static {
    async fn execute_media(&self, command: &str, value: Option<u8>) -> Result<Value, String>;
    async fn set_stream_enabled(&self, enabled: bool) -> Result<(), String>;
}

pub fn generate_id(prefix: &str) -> String {
    let mut bytes = [0_u8; 8];
    rand::rng().fill_bytes(&mut bytes);
    let mut hex = String::with_capacity(16);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    format!("{prefix}-{hex}")
}

pub fn create_default_document() -> Value {
    let page_id = generate_id("page");
    let deck_id = generate_id("deck");
    json!({
        "schemaVersion": 1,
        "revision": 0,
        "stateRevision": 0,
        "activeDeckId": deck_id,
        "activePageId": page_id,
        "autoSwitchEnabled": false,
        "variables": {},
        "controlStates": {},
        "decks": [{
            "id": deck_id,
            "name": "Aether Deck",
            "enabled": true,
            "defaultPageId": page_id,
            "autoSwitchEnabled": false,
            "applicationRules": [],
            "pages": [{
                "id": page_id,
                "name": "Главная",
                "columns": 4,
                "background": "#08090b",
                "backgroundAsset": null,
                "parentPageId": null,
                "controls": []
            }]
        }]
    })
}

pub fn describe_providers(obs_connected: bool) -> Value {
    let aether_actions = [
        ("media.playPause", "Play / Pause", "toggle", &["button", "toggle"][..]),
        ("media.next", "Следующий трек", "trigger", &["button"][..]),
        ("media.previous", "Предыдущий трек", "trigger", &["button"][..]),
        ("audio.volumeUp", "Громче", "trigger", &["button"][..]),
        ("audio.volumeDown", "Тише", "trigger", &["button"][..]),
        ("audio.mute", "Mute", "toggle", &["button", "toggle"][..]),
        ("audio.setVolume", "Установить громкость", "number", &["slider", "button"][..]),
        ("power.lock", "Заблокировать ПК", "trigger", &["button"][..]),
        ("power.sleep", "Сон", "trigger", &["button"][..]),
        ("power.shutdown", "Выключить ПК", "trigger", &["button"][..]),
        ("power.restart", "Перезагрузить ПК", "trigger", &["button"][..]),
        ("window.closeActive", "Закрыть активное окно", "trigger", &["button"][..]),
        ("stream.start", "Запустить трансляцию экрана", "toggle", &["button", "toggle"][..]),
        ("stream.stop", "Остановить трансляцию экрана", "toggle", &["button", "toggle"][..]),
    ];

    let audio_actions = [
        ("audio.masterVolume", "Общая громкость", "number", &["slider", "button"][..]),
        ("audio.masterMute", "Общий Mute", "toggle", &["button", "toggle"][..]),
    ];

    let system_actions = [
        ("system.launchApplication", "Открыть приложение"),
        ("system.runProgram", "Запустить программу"),
        ("system.openFile", "Открыть файл"),
        ("system.openFolder", "Открыть папку"),
        ("system.openUrl", "Открыть URL"),
        ("system.typeText", "Ввести текст"),
        ("window.minimize", "Свернуть активное окно"),
        ("window.maximize", "Развернуть активное окно"),
        ("window.restore", "Восстановить активное окно"),
        ("window.close", "Закрыть активное окно"),
    ];

    let input_actions = [
        ("input.key", "Одиночная клавиша"),
        ("input.hotkey", "Горячая клавиша"),
        ("input.sequence", "Последовательность клавиш"),
        ("input.text", "Ввод текста"),
    ];

    let nav_actions = [
        ("navigation.page", "Открыть страницу"),
        ("navigation.deck", "Открыть Deck"),
        ("navigation.back", "Назад"),
    ];

    let obs_actions = [
        ("obs.stream.start", "Запустить стрим", true),
        ("obs.stream.stop", "Остановить стрим", true),
        ("obs.stream.toggle", "Переключить стрим", true),
        ("obs.record.start", "Начать запись", true),
        ("obs.record.stop", "Остановить запись", true),
        ("obs.record.toggle", "Переключить запись", true),
        ("obs.record.pause", "Пауза записи", false),
        ("obs.record.resume", "Продолжить запись", false),
        ("obs.scene.set", "Переключить сцену", false),
        ("obs.source.visibility", "Видимость источника", true),
        ("obs.source.mute", "Mute источника", true),
        ("obs.studioMode", "Studio Mode", true),
        ("obs.transition", "Переход", false),
        ("obs.replay.save", "Сохранить Replay Buffer", false),
    ];

    let map_list = |items: &[(&str, &str, &str, &[&str])]| -> Vec<Value> {
        items
            .iter()
            .map(|(t, n, i, c)| {
                json!({
                    "type": t,
                    "name": n,
                    "inputType": i,
                    "supportedControlTypes": c
                })
            })
            .collect()
    };

    json!([
        {
            "id": "aether",
            "name": "Aether Remote",
            "available": true,
            "actions": map_list(&aether_actions),
        },
        {
            "id": "audio",
            "name": "Аудио",
            "available": true,
            "actions": map_list(&audio_actions),
        },
        {
            "id": "system",
            "name": "Система",
            "available": true,
            "actions": system_actions.iter().map(|(t, n)| json!({
                "type": t, "name": n, "inputType": "trigger", "supportedControlTypes": ["button"]
            })).collect::<Vec<_>>(),
        },
        {
            "id": "input",
            "name": "Клавиатура",
            "available": true,
            "actions": input_actions.iter().map(|(t, n)| json!({
                "type": t, "name": n, "inputType": "trigger", "supportedControlTypes": ["button"]
            })).collect::<Vec<_>>(),
        },
        {
            "id": "navigation",
            "name": "Навигация",
            "available": true,
            "actions": nav_actions.iter().map(|(t, n)| json!({
                "type": t, "name": n, "inputType": "trigger", "supportedControlTypes": ["folder"]
            })).collect::<Vec<_>>(),
        },
        {
            "id": "obs",
            "name": "OBS Studio",
            "available": obs_connected,
            "actions": obs_actions.iter().map(|(t, n, is_toggle)| json!({
                "type": t,
                "name": n,
                "inputType": if *is_toggle { "toggle" } else { "trigger" },
                "supportedControlTypes": if *is_toggle { vec!["button", "toggle"] } else { vec!["button"] }
            })).collect::<Vec<_>>(),
        }
    ])
}

#[derive(Clone)]
struct ClientNav {
    deck_id: String,
    page_id: String,
    history: Vec<(String, String)>,
    slider_sequences: HashMap<String, i64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ObsSettings {
    pub url: String,
    #[serde(default)]
    pub password: String,
}

impl Default for ObsSettings {
    fn default() -> Self {
        Self {
            url: "ws://127.0.0.1:4455".to_owned(),
            password: String::new(),
        }
    }
}

pub fn validate_obs_ws_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "OBS URL is invalid".to_owned())?;
    if !matches!(parsed.scheme(), "ws" | "wss")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || (parsed.path() != "/" && !parsed.path().is_empty())
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("OBS URL must use ws:// or wss:// cleanly".to_owned());
    }
    let host = parsed.host_str().unwrap_or_default().trim_matches(['[', ']']);
    let allowed = if host.eq_ignore_ascii_case("localhost") {
        true
    } else if let Ok(ip) = host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
            IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        }
    } else {
        false
    };
    if !allowed {
        return Err("OBS URL must target localhost or a private LAN IP".to_owned());
    }
    Ok(parsed)
}

#[derive(Clone)]
struct ObsClient {
    command_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<ObsCommand>>>>,
    connected: Arc<AtomicBool>,
    streaming: Arc<AtomicBool>,
    recording: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    settings: Arc<StdMutex<ObsSettings>>,
}

enum ObsCommand {
    Request {
        request_type: String,
        request_data: Value,
        reply: oneshot::Sender<Result<Value, String>>,
    },
    Shutdown,
}

impl ObsClient {
    fn new(settings: ObsSettings) -> Self {
        Self {
            command_tx: Arc::new(Mutex::new(None)),
            connected: Arc::new(AtomicBool::new(false)),
            streaming: Arc::new(AtomicBool::new(false)),
            recording: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            settings: Arc::new(StdMutex::new(settings)),
        }
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Acquire)
    }

    fn obs_flags(&self) -> (bool, bool, bool) {
        (
            self.connected.load(Ordering::Acquire),
            self.streaming.load(Ordering::Acquire),
            self.recording.load(Ordering::Acquire),
        )
    }

    fn settings(&self) -> ObsSettings {
        self.settings.lock().map(|g| g.clone()).unwrap_or_default()
    }

    async fn connect(&self, next: ObsSettings) -> Result<(), String> {
        let parsed = validate_obs_ws_url(&next.url)?;
        if let Ok(mut guard) = self.settings.lock() {
            *guard = next.clone();
        }
        if let Some(old) = self.command_tx.lock().await.take() {
            let _ = old.send(ObsCommand::Shutdown);
        }
        let my_gen = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.connected.store(false, Ordering::Release);
        self.streaming.store(false, Ordering::Release);
        self.recording.store(false, Ordering::Release);

        let url_str = parsed.as_str().to_owned();
        let password = next.password;
        let (ws_stream, _) = tokio::time::timeout(
            Duration::from_secs(6),
            tokio_tungstenite::connect_async(&url_str),
        )
        .await
        .map_err(|_| "OBS connection timed out".to_owned())?
        .map_err(|e| format!("Failed to connect to OBS: {e}"))?;

        let (mut write, mut read) = ws_stream.split();

        let hello_msg = tokio::time::timeout(Duration::from_secs(5), read.next())
            .await
            .map_err(|_| "Timed out waiting for OBS Hello".to_owned())?
            .ok_or("OBS closed connection before Hello")?
            .map_err(|e| format!("OBS WebSocket error: {e}"))?;

        let hello_text = hello_msg.into_text().map_err(|_| "OBS sent non-text Hello".to_owned())?;
        let hello: Value = serde_json::from_str(&hello_text).map_err(|_| "Invalid OBS Hello JSON".to_owned())?;
        if hello.get("op").and_then(Value::as_u64) != Some(0) {
            return Err("Unexpected OBS handshake opcode".to_owned());
        }
        let d = hello.get("d").cloned().unwrap_or(Value::Null);
        let rpc_version = d.get("rpcVersion").and_then(Value::as_u64).unwrap_or(1).min(1);
        let mut identify_d = json!({ "rpcVersion": rpc_version, "eventSubscriptions": 2047 });

        if let Some(auth) = d.get("authentication")
            && let (Some(salt), Some(challenge)) = (
                auth.get("salt").and_then(Value::as_str),
                auth.get("challenge").and_then(Value::as_str),
            )
        {
            let secret_hash = Sha256::digest(format!("{password}{salt}").as_bytes());
            let secret_b64 = STANDARD.encode(secret_hash);
            let auth_hash = Sha256::digest(format!("{secret_b64}{challenge}").as_bytes());
            identify_d["authentication"] = json!(STANDARD.encode(auth_hash));
        }

        write
            .send(TungsteniteMessage::Text(json!({ "op": 1, "d": identify_d }).to_string().into()))
            .await
            .map_err(|e| format!("Failed to send OBS Identify: {e}"))?;

        loop {
            let msg = tokio::time::timeout(Duration::from_secs(5), read.next())
                .await
                .map_err(|_| "OBS authentication timed out".to_owned())?
                .ok_or("OBS closed during identification")?
                .map_err(|e| format!("OBS handshake read error: {e}"))?;
            if let TungsteniteMessage::Text(txt) = msg {
                let parsed: Value = serde_json::from_str(&txt).unwrap_or(Value::Null);
                if parsed.get("op").and_then(Value::as_u64) == Some(2) {
                    break;
                }
            } else if matches!(msg, TungsteniteMessage::Close(_)) {
                return Err("OBS rejected authentication (check password)".to_owned());
            }
        }

        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<ObsCommand>();
        *self.command_tx.lock().await = Some(cmd_tx);
        self.connected.store(true, Ordering::Release);
        let connected_flag = self.connected.clone();
        let streaming_flag = self.streaming.clone();
        let recording_flag = self.recording.clone();
        let gen_arc = self.generation.clone();

        tokio::spawn(async move {
            let mut pending: HashMap<String, oneshot::Sender<Result<Value, String>>> = HashMap::new();
            let mut seq: u64 = 0;
            loop {
                tokio::select! {
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(ObsCommand::Request { request_type, request_data, reply }) => {
                                seq += 1;
                                let req_id = format!("aether-obs-{seq}");
                                let payload = json!({
                                    "op": 6,
                                    "d": {
                                        "requestType": request_type,
                                        "requestId": req_id,
                                        "requestData": request_data
                                    }
                                });
                                if write.send(TungsteniteMessage::Text(payload.to_string().into())).await.is_err() {
                                    let _ = reply.send(Err("OBS socket write failed".to_owned()));
                                    break;
                                }
                                pending.insert(req_id, reply);
                            }
                            Some(ObsCommand::Shutdown) | None => break,
                        }
                    }
                    ws_msg = read.next() => {
                        let Some(Ok(frame)) = ws_msg else { break };
                        if let TungsteniteMessage::Text(txt) = frame {
                            let val: Value = serde_json::from_str(&txt).unwrap_or(Value::Null);
                            let op = val.get("op").and_then(Value::as_u64);
                            if op == Some(7)
                                && let Some(d) = val.get("d")
                                && let Some(req_id) = d.get("requestId").and_then(Value::as_str)
                                && let Some(reply) = pending.remove(req_id)
                            {
                                let ok = d.pointer("/requestStatus/result").and_then(Value::as_bool).unwrap_or(false);
                                if ok {
                                    let _ = reply.send(Ok(d.get("responseData").cloned().unwrap_or(json!({}))));
                                } else {
                                    let comment = d.pointer("/requestStatus/comment").and_then(Value::as_str).unwrap_or("OBS request failed");
                                    let _ = reply.send(Err(comment.to_owned()));
                                }
                            } else if op == Some(5)
                                && let Some(d) = val.get("d")
                                && let Some(ev_type) = d.get("eventType").and_then(Value::as_str)
                            {
                                let active = d.pointer("/eventData/outputActive").and_then(Value::as_bool);
                                match ev_type {
                                    "StreamStateChanged" => if let Some(a) = active { streaming_flag.store(a, Ordering::Release); },
                                    "RecordStateChanged" => if let Some(a) = active { recording_flag.store(a, Ordering::Release); },
                                    _ => {}
                                }
                            }
                        } else if matches!(frame, TungsteniteMessage::Close(_)) {
                            break;
                        }
                    }
                }
            }
            if gen_arc.load(Ordering::Acquire) == my_gen {
                connected_flag.store(false, Ordering::Release);
                streaming_flag.store(false, Ordering::Release);
                recording_flag.store(false, Ordering::Release);
            }
            for (_, reply) in pending {
                let _ = reply.send(Err("OBS disconnected".to_owned()));
            }
        });

        Ok(())
    }

    async fn request(&self, request_type: &str, request_data: Value) -> Result<Value, String> {
        let tx = self
            .command_tx
            .lock()
            .await
            .clone()
            .ok_or("OBS is not connected")?;
        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(ObsCommand::Request {
            request_type: request_type.to_owned(),
            request_data,
            reply: reply_tx,
        })
        .map_err(|_| "OBS is disconnected".to_owned())?;
        tokio::time::timeout(Duration::from_secs(10), reply_rx)
            .await
            .map_err(|_| "OBS request timed out".to_owned())?
            .map_err(|_| "OBS request dropped".to_owned())?
    }
}

pub struct DeckService {
    dir: PathBuf,
    document: Mutex<Value>,
    control_states: Mutex<BTreeMap<String, Value>>,
    runtime_variables: Mutex<BTreeMap<String, Value>>,
    state_revision: AtomicU64,
    slider_server_sequence: AtomicU64,
    sessions: Mutex<HashMap<String, ClientNav>>,
    obs: ObsClient,
    executor: Arc<dyn DeckExecutor>,
    approval_gate: Arc<dyn ApprovalGate>,
    outbound: tokio::sync::broadcast::Sender<Value>,
}

impl DeckService {
    pub fn new(
        data_dir: PathBuf,
        executor: Arc<dyn DeckExecutor>,
        approval_gate: Arc<dyn ApprovalGate>,
        outbound: tokio::sync::broadcast::Sender<Value>,
    ) -> Self {
        let dir = data_dir.join("aether-deck");
        let _ = fs::create_dir_all(dir.join("assets"));
        let doc_path = dir.join("document.json");
        let doc = fs::read_to_string(&doc_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .filter(|v| v.get("decks").and_then(Value::as_array).is_some_and(|a| !a.is_empty()))
            .unwrap_or_else(|| {
                let d = create_default_document();
                if let Ok(text) = serde_json::to_string_pretty(&d) {
                    let _ = fs::write(&doc_path, text);
                }
                d
            });
        let obs_path = dir.join("obs.json");
        let obs_settings = fs::read_to_string(&obs_path)
            .ok()
            .and_then(|s| serde_json::from_str::<ObsSettings>(&s).ok())
            .unwrap_or_default();

        let state_rev = doc.get("stateRevision").and_then(Value::as_u64).unwrap_or(0);
        let initial_states: BTreeMap<String, Value> = doc
            .get("controlStates")
            .and_then(Value::as_object)
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();

        Self {
            dir,
            document: Mutex::new(doc),
            control_states: Mutex::new(initial_states),
            runtime_variables: Mutex::new(BTreeMap::new()),
            state_revision: AtomicU64::new(state_rev),
            slider_server_sequence: AtomicU64::new(0),
            sessions: Mutex::new(HashMap::new()),
            obs: ObsClient::new(obs_settings),
            executor,
            approval_gate,
            outbound,
        }
    }

    pub async fn get_document(&self) -> Value {
        self.document.lock().await.clone()
    }

    pub async fn get_providers(&self) -> Value {
        describe_providers(self.obs.is_connected())
    }

    pub async fn save_document(&self, mut input: Value) -> Result<Value, String> {
        let mut doc_guard = self.document.lock().await;
        let prev_rev = doc_guard.get("revision").and_then(Value::as_u64).unwrap_or(0);
        let next_rev = prev_rev + 1;
        let Some(obj) = input.as_object_mut() else {
            return Err("Deck document must be a JSON object".to_owned());
        };
        let has_decks = obj
            .get("decks")
            .and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty());
        if !has_decks {
            return Err("Deck document must contain at least one deck".to_owned());
        }
        obj.insert("revision".to_owned(), json!(next_rev));
        obj.insert(
            "stateRevision".to_owned(),
            json!(self.state_revision.load(Ordering::Acquire)),
        );

        let serialized = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
        fs::write(self.dir.join("document.json"), serialized).map_err(|e| e.to_string())?;
        *doc_guard = input.clone();
        drop(doc_guard);

        let snapshot_doc = self.hydrated_document(&input, None, None).await;
        let _ = self.outbound.send(json!({
            "action": "DECK_PATCH",
            "fromRevision": prev_rev,
            "toRevision": next_rev,
            "document": snapshot_doc
        }));

        Ok(input)
    }

    pub fn import_asset_from_path(&self, path: &Path) -> Result<Value, String> {
        let bytes = fs::read(path).map_err(|e| format!("Failed to read asset: {e}"))?;
        if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
            return Err("Asset size must be between 1 byte and 2 MiB".to_owned());
        }
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mime_type = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => return Err("Only PNG, JPG, GIF, or WebP assets are supported".to_owned()),
        };
        let hash_bytes = Sha256::digest(&bytes);
        let mut hash = String::with_capacity(64);
        for b in hash_bytes {
            use std::fmt::Write;
            let _ = write!(&mut hash, "{:02x}", b);
        }
        let assets_dir = self.dir.join("assets");
        fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
        fs::write(assets_dir.join(format!("{hash}.bin")), &bytes).map_err(|e| e.to_string())?;
        fs::write(
            assets_dir.join(format!("{hash}.meta.json")),
            json!({ "hash": hash, "mimeType": mime_type, "size": bytes.len() }).to_string(),
        )
        .map_err(|e| e.to_string())?;

        Ok(json!({
            "canceled": false,
            "asset": {
                "hash": hash,
                "mimeType": mime_type,
                "size": bytes.len(),
                "fileName": path.file_name().and_then(|s| s.to_str()).unwrap_or("icon")
            }
        }))
    }

    pub async fn export_package_to_path(&self, dest: &Path) -> Result<Value, String> {
        let doc = self.document.lock().await.clone();
        let assets_dir = self.dir.join("assets");
        let mut assets_map = Map::new();
        if let Ok(entries) = fs::read_dir(&assets_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) == Some("bin")
                    && let Some(stem) = p.file_stem().and_then(|s| s.to_str())
                    && let Ok(bytes) = fs::read(&p)
                {
                    let mime = fs::read_to_string(assets_dir.join(format!("{stem}.meta.json")))
                        .ok()
                        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                        .and_then(|v| v.get("mimeType").and_then(Value::as_str).map(ToOwned::to_owned))
                        .unwrap_or_else(|| "image/png".to_owned());
                    assets_map.insert(
                        stem.to_owned(),
                        json!({ "mimeType": mime, "data": STANDARD.encode(bytes) }),
                    );
                }
            }
        }
        let pkg = json!({
            "packageType": "aether-deck",
            "packageVersion": 1,
            "format": "aether-deck-package",
            "version": 1,
            "document": doc,
            "assets": Value::Object(assets_map)
        });
        let text = serde_json::to_string_pretty(&pkg).map_err(|e| e.to_string())?;
        fs::write(dest, text).map_err(|e| e.to_string())?;
        Ok(json!({ "canceled": false, "path": dest.to_string_lossy() }))
    }

    pub async fn import_package_from_path(&self, src: &Path) -> Result<Value, String> {
        let raw = fs::read_to_string(src).map_err(|e| e.to_string())?;
        let pkg: Value = serde_json::from_str(&raw).map_err(|_| "Invalid .aetherdeck file".to_owned())?;
        let assets_dir = self.dir.join("assets");
        let _ = fs::create_dir_all(&assets_dir);
        let save_asset = |hash: &str, item: &Value| {
            let valid_hash = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit());
            if valid_hash
                && let Some(b64) = item.get("data").and_then(Value::as_str)
                && let Ok(bytes) = STANDARD.decode(b64)
                && bytes.len() <= 2 * 1024 * 1024
            {
                let mime = item.get("mimeType").and_then(Value::as_str).unwrap_or("image/png");
                let _ = fs::write(assets_dir.join(format!("{hash}.bin")), &bytes);
                let _ = fs::write(
                    assets_dir.join(format!("{hash}.meta.json")),
                    json!({ "hash": hash, "mimeType": mime, "size": bytes.len() }).to_string(),
                );
            }
        };
        if let Some(assets) = pkg.get("assets").and_then(Value::as_object) {
            for (hash, item) in assets {
                save_asset(hash, item);
            }
        } else if let Some(assets) = pkg.get("assets").and_then(Value::as_array) {
            for item in assets {
                if let Some(hash) = item.get("hash").and_then(Value::as_str) {
                    save_asset(hash, item);
                }
            }
        }
        let doc = pkg
            .get("document")
            .cloned()
            .ok_or("Missing document inside package")?;
        let saved = self.save_document(doc).await?;
        Ok(json!({ "canceled": false, "document": saved }))
    }

    pub fn obs_state(&self) -> (bool, bool, bool) {
        self.obs.obs_flags()
    }

    pub async fn try_connect_saved_obs(&self) {
        let obs_path = self.dir.join("obs.json");
        if obs_path.exists() {
            let settings = self.obs.settings();
            let _ = self.obs.connect(settings).await;
        }
    }

    pub fn get_obs_settings(&self) -> Value {
        let settings = self.obs.settings();
        json!({
            "url": settings.url,
            "connected": self.obs.is_connected()
        })
    }

    pub async fn set_obs_settings(&self, url: String, password: String) -> Result<Value, String> {
        let next = ObsSettings {
            url: if url.trim().is_empty() {
                "ws://127.0.0.1:4455".to_owned()
            } else {
                url
            },
            password,
        };
        let _ = fs::write(
            self.dir.join("obs.json"),
            serde_json::to_string_pretty(&next).unwrap_or_default(),
        );
        self.obs.connect(next.clone()).await?;
        Ok(json!({
            "url": next.url,
            "connected": self.obs.is_connected()
        }))
    }

    pub async fn publish_runtime_variables(&self, patch: Map<String, Value>) {
        let mut vars = self.runtime_variables.lock().await;
        let mut changed = Map::new();
        for (k, v) in patch {
            if vars.get(&k) != Some(&v) {
                vars.insert(k.clone(), v.clone());
                changed.insert(k, v);
            }
        }
        if !changed.is_empty() {
            let rev = self.state_revision.fetch_add(1, Ordering::AcqRel) + 1;
            let _ = self.outbound.send(json!({
                "action": "DECK_STATE_PATCH",
                "stateRevision": rev,
                "variables": Value::Object(changed)
            }));
        }
    }

    async fn hydrated_document(
        &self,
        raw_doc: &Value,
        override_deck: Option<&str>,
        override_page: Option<&str>,
    ) -> Value {
        let mut doc = raw_doc.clone();
        if let Some(obj) = doc.as_object_mut() {
            if let Some(d) = override_deck {
                obj.insert("activeDeckId".to_owned(), json!(d));
            }
            if let Some(p) = override_page {
                obj.insert("activePageId".to_owned(), json!(p));
            }
            let states = self.control_states.lock().await.clone();
            obj.insert(
                "controlStates".to_owned(),
                Value::Object(states.into_iter().collect()),
            );
            let mut merged_vars = obj
                .get("variables")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let runtime = self.runtime_variables.lock().await.clone();
            for (k, v) in runtime {
                merged_vars.insert(k, v);
            }
            obj.insert("variables".to_owned(), Value::Object(merged_vars));
        }
        doc
    }

    fn resolve_valid_nav(doc: &Value, preferred: Option<(&str, &str)>) -> Option<(String, String)> {
        let decks = doc.get("decks")?.as_array()?;
        let default_deck_id = doc.get("activeDeckId").and_then(Value::as_str).unwrap_or("");
        let req_deck = preferred
            .and_then(|(d, _)| decks.iter().find(|item| item.get("id").and_then(Value::as_str) == Some(d)));
        let deck = req_deck
            .or_else(|| decks.iter().find(|item| item.get("id").and_then(Value::as_str) == Some(default_deck_id)))
            .or_else(|| decks.first())?;
        let deck_id = deck.get("id")?.as_str()?.to_owned();
        let pages = deck.get("pages")?.as_array()?;
        let default_page_id = deck
            .get("defaultPageId")
            .and_then(Value::as_str)
            .or_else(|| doc.get("activePageId").and_then(Value::as_str))
            .unwrap_or("");
        let page = preferred
            .and_then(|(_, p)| pages.iter().find(|item| item.get("id").and_then(Value::as_str) == Some(p)))
            .or_else(|| pages.iter().find(|item| item.get("id").and_then(Value::as_str) == Some(default_page_id)))
            .or_else(|| pages.first())?;
        let page_id = page.get("id")?.as_str()?.to_owned();
        Some((deck_id, page_id))
    }

    pub async fn handle_ws_message(
        &self,
        session_key: &str,
        action: &str,
        fields: &BTreeMap<String, Value>,
        client_ip: &str,
    ) -> Vec<Value> {
        let mut responses = Vec::new();
        match action {
            "DECK_SYNC_REQUEST" => {
                let doc = self.document.lock().await.clone();
                let mut sessions = self.sessions.lock().await;
                let prev = sessions
                    .get(session_key)
                    .map(|n| (n.deck_id.as_str(), n.page_id.as_str()));
                if let Some((deck_id, page_id)) = Self::resolve_valid_nav(&doc, prev) {
                    sessions.insert(
                        session_key.to_owned(),
                        ClientNav {
                            deck_id: deck_id.clone(),
                            page_id: page_id.clone(),
                            history: Vec::new(),
                            slider_sequences: HashMap::new(),
                        },
                    );
                    drop(sessions);
                    let rev = doc.get("revision").and_then(Value::as_u64).unwrap_or(0);
                    let state_rev = self.state_revision.load(Ordering::Acquire);
                    let hydrated = self.hydrated_document(&doc, Some(&deck_id), Some(&page_id)).await;
                    responses.push(json!({
                        "action": "DECK_SNAPSHOT",
                        "revision": rev,
                        "stateRevision": state_rev,
                        "activeDeckId": deck_id,
                        "activePageId": page_id,
                        "document": hydrated,
                        "providers": describe_providers(self.obs.is_connected()),
                    }));
                }
            }
            "DECK_NAVIGATE" | "DECK_BACK" => {
                let go_back = action == "DECK_BACK"
                    || fields.get("back").and_then(Value::as_bool).unwrap_or(false);
                if let Some(msg) = self
                    .navigate_session(
                        session_key,
                        fields.get("deckId").and_then(Value::as_str),
                        fields.get("pageId").and_then(Value::as_str),
                        go_back,
                    )
                    .await
                {
                    responses.push(msg);
                }
            }
            "DECK_ASSET_REQUEST" => {
                let requested_hash = fields.get("hash").and_then(Value::as_str).unwrap_or("");
                let valid = requested_hash.len() == 64 && requested_hash.bytes().all(|b| b.is_ascii_hexdigit());
                if !valid {
                    responses.push(json!({
                        "action": "DECK_ASSET_ERROR",
                        "hash": requested_hash,
                        "status": "NOT_FOUND",
                        "error": "Invalid asset hash"
                    }));
                    return responses;
                }
                let bin_path = self.dir.join("assets").join(format!("{requested_hash}.bin"));
                let meta_path = self.dir.join("assets").join(format!("{requested_hash}.meta.json"));
                match fs::read(&bin_path) {
                    Ok(bytes) => {
                        let mime = fs::read_to_string(&meta_path)
                            .ok()
                            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                            .and_then(|v| v.get("mimeType").and_then(Value::as_str).map(ToOwned::to_owned))
                            .unwrap_or_else(|| "image/png".to_owned());
                        let chunk_size = 48 * 1024;
                        let chunks = bytes.len().div_ceil(chunk_size).max(1);
                        for (index, chunk) in bytes.chunks(chunk_size).enumerate() {
                            responses.push(json!({
                                "action": "DECK_ASSET_CHUNK",
                                "hash": requested_hash,
                                "mimeType": mime,
                                "index": index,
                                "chunks": chunks,
                                "data": STANDARD.encode(chunk)
                            }));
                        }
                    }
                    Err(_) => {
                        responses.push(json!({
                            "action": "DECK_ASSET_ERROR",
                            "hash": requested_hash,
                            "status": "NOT_FOUND",
                            "error": "Aether Deck asset not found"
                        }));
                    }
                }
            }
            "DECK_TRIGGER" | "DECK_SLIDER" => {
                let trigger_id = fields.get("triggerId").and_then(Value::as_str).unwrap_or("");
                let control_id = fields.get("controlId").and_then(Value::as_str).unwrap_or("");
                let deck_id = fields.get("deckId").and_then(Value::as_str).unwrap_or("");
                let page_id = fields.get("pageId").and_then(Value::as_str).unwrap_or("");
                let req_rev = fields.get("revision").and_then(Value::as_u64).unwrap_or(0);

                let doc = self.document.lock().await.clone();
                let doc_rev = doc.get("revision").and_then(Value::as_u64).unwrap_or(0);
                if req_rev != doc_rev {
                    responses.push(json!({
                        "action": "DECK_ACTION_RESULT",
                        "triggerId": trigger_id,
                        "controlId": control_id,
                        "status": "STALE_REVISION",
                        "revision": doc_rev
                    }));
                    return responses;
                }

                let control = doc
                    .get("decks")
                    .and_then(Value::as_array)
                    .and_then(|ds| ds.iter().find(|d| d.get("id").and_then(Value::as_str) == Some(deck_id)))
                    .and_then(|d| d.get("pages").and_then(Value::as_array))
                    .and_then(|ps| ps.iter().find(|p| p.get("id").and_then(Value::as_str) == Some(page_id)))
                    .and_then(|p| p.get("controls").and_then(Value::as_array))
                    .and_then(|cs| cs.iter().find(|c| c.get("id").and_then(Value::as_str) == Some(control_id)))
                    .cloned();

                let Some(control) = control else {
                    responses.push(json!({
                        "action": "DECK_ACTION_RESULT",
                        "triggerId": trigger_id,
                        "controlId": control_id,
                        "status": "CONTROL_NOT_FOUND",
                        "revision": doc_rev
                    }));
                    return responses;
                };

                let c_type = control.get("type").and_then(Value::as_str).unwrap_or("button");
                if action == "DECK_TRIGGER" && c_type == "folder" {
                    let target_page = control.get("targetPageId").and_then(Value::as_str).unwrap_or("");
                    if !target_page.is_empty()
                        && let Some((vd, vp)) = Self::resolve_valid_nav(&doc, Some((deck_id, target_page)))
                    {
                        let mut sessions = self.sessions.lock().await;
                        if let Some(sess) = sessions.get_mut(session_key) {
                            sess.history.push((sess.deck_id.clone(), sess.page_id.clone()));
                            sess.deck_id = vd.clone();
                            sess.page_id = vp.clone();
                        }
                        responses.push(json!({
                            "action": "DECK_NAVIGATION",
                            "deckId": vd,
                            "pageId": vp
                        }));
                    } else {
                        responses.push(json!({
                            "action": "DECK_ACTION_RESULT",
                            "triggerId": trigger_id,
                            "controlId": control_id,
                            "status": "TARGET_UNAVAILABLE",
                            "revision": doc_rev
                        }));
                    }
                    return responses;
                }

                let mut value_override: Option<f64> = None;
                if action == "DECK_SLIDER" {
                    if c_type != "slider" {
                        return responses;
                    }
                    let sequence = fields.get("sequence").and_then(Value::as_i64).unwrap_or(0);
                    let raw_value = fields.get("value").and_then(Value::as_f64);
                    let Some(raw_val) = raw_value.filter(|v| v.is_finite()) else {
                        responses.push(json!({
                            "action": "DECK_ACTION_RESULT",
                            "triggerId": trigger_id,
                            "controlId": control_id,
                            "status": "INVALID_VALUE",
                            "revision": doc_rev
                        }));
                        return responses;
                    };
                    if sequence < 1 {
                        responses.push(json!({
                            "action": "DECK_ACTION_RESULT",
                            "triggerId": trigger_id,
                            "controlId": control_id,
                            "status": "INVALID_VALUE",
                            "revision": doc_rev
                        }));
                        return responses;
                    }
                    {
                        let mut sessions = self.sessions.lock().await;
                        if let Some(sess) = sessions.get_mut(session_key) {
                            let prev_seq = sess.slider_sequences.get(control_id).copied().unwrap_or(-1);
                            if sequence <= prev_seq {
                                return responses;
                            }
                            sess.slider_sequences.insert(control_id.to_owned(), sequence);
                        }
                    }
                    let min_v = control.get("minimum").and_then(Value::as_f64).unwrap_or(0.0);
                    let max_v = control.get("maximum").and_then(Value::as_f64).unwrap_or(100.0);
                    let step_v = control.get("step").and_then(Value::as_f64).unwrap_or(1.0).max(0.001);
                    let clamped = raw_val.clamp(min_v, max_v);
                    let stepped = (min_v + ((clamped - min_v) / step_v).round() * step_v).clamp(min_v, max_v);
                    value_override = Some(stepped);

                    let srv_seq = self.slider_server_sequence.fetch_add(1, Ordering::AcqRel) + 1;
                    self.publish_control_state(
                        control_id,
                        json!({ "value": stepped, "sequence": srv_seq }),
                    )
                    .await;
                }

                let (branch_actions, next_toggle_active) = if c_type == "toggle" {
                    let currently_active = self
                        .control_states
                        .lock()
                        .await
                        .get(control_id)
                        .and_then(|v| v.get("active"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let next_active = !currently_active;
                    let list = if currently_active {
                        control
                            .get("actionsB")
                            .and_then(Value::as_array)
                            .cloned()
                            .filter(|a| !a.is_empty())
                            .unwrap_or_else(|| control.get("actions").and_then(Value::as_array).cloned().unwrap_or_default())
                    } else {
                        control.get("actions").and_then(Value::as_array).cloned().unwrap_or_default()
                    };
                    (list, Some(next_active))
                } else {
                    (
                        control.get("actions").and_then(Value::as_array).cloned().unwrap_or_default(),
                        None,
                    )
                };

                let mut action_replies = Vec::new();
                let result = self
                    .execute_actions(
                        session_key,
                        &branch_actions,
                        value_override,
                        client_ip,
                        &mut action_replies,
                    )
                    .await;
                responses.extend(action_replies);

                if let (Ok(_), Some(next_active)) = (&result, next_toggle_active) {
                    self.publish_control_state(control_id, json!({ "active": next_active }))
                        .await;
                }

                match result {
                    Ok(msg) => responses.push(json!({
                        "action": "DECK_ACTION_RESULT",
                        "triggerId": trigger_id,
                        "controlId": control_id,
                        "status": "success",
                        "result": msg
                    })),
                    Err(err) => responses.push(json!({
                        "action": "DECK_ACTION_RESULT",
                        "triggerId": trigger_id,
                        "controlId": control_id,
                        "status": "error",
                        "error": err
                    })),
                }
            }
            _ => {}
        }
        responses
    }

    async fn navigate_session(
        &self,
        session_key: &str,
        req_deck: Option<&str>,
        req_page: Option<&str>,
        go_back: bool,
    ) -> Option<Value> {
        let doc = self.document.lock().await.clone();
        let mut sessions = self.sessions.lock().await;
        let entry = sessions.entry(session_key.to_owned()).or_insert_with(|| {
            let (d, p) = Self::resolve_valid_nav(&doc, None).unwrap_or_default();
            ClientNav {
                deck_id: d,
                page_id: p,
                history: Vec::new(),
                slider_sequences: HashMap::new(),
            }
        });
        if go_back {
            if let Some((prev_d, prev_p)) = entry.history.pop()
                && let Some((vd, vp)) = Self::resolve_valid_nav(&doc, Some((&prev_d, &prev_p)))
            {
                entry.deck_id = vd;
                entry.page_id = vp;
            }
            return Some(json!({
                "action": "DECK_NAVIGATION",
                "deckId": entry.deck_id,
                "pageId": entry.page_id,
            }));
        }
        let target_d = req_deck.filter(|s| !s.is_empty()).unwrap_or(&entry.deck_id);
        let target_p = req_page.filter(|s| !s.is_empty()).unwrap_or(&entry.page_id);
        if let Some((vd, vp)) = Self::resolve_valid_nav(&doc, Some((target_d, target_p))) {
            if vd != entry.deck_id || vp != entry.page_id {
                entry.history.push((entry.deck_id.clone(), entry.page_id.clone()));
                if entry.history.len() > 50 {
                    entry.history.remove(0);
                }
                entry.deck_id = vd;
                entry.page_id = vp;
            }
            Some(json!({
                "action": "DECK_NAVIGATION",
                "deckId": entry.deck_id,
                "pageId": entry.page_id,
            }))
        } else {
            None
        }
    }

    async fn publish_control_state(&self, control_id: &str, patch: Value) {
        let mut states = self.control_states.lock().await;
        let entry = states.entry(control_id.to_owned()).or_insert_with(|| json!({}));
        if let (Some(target), Some(p)) = (entry.as_object_mut(), patch.as_object()) {
            for (k, v) in p {
                target.insert(k.clone(), v.clone());
            }
        }
        let updated = entry.clone();
        drop(states);

        let rev = self.state_revision.fetch_add(1, Ordering::AcqRel) + 1;
        let _ = self.outbound.send(json!({
            "action": "DECK_STATE_PATCH",
            "stateRevision": rev,
            "states": { control_id: updated }
        }));
    }

    async fn condition_matches(&self, condition: &Value) -> bool {
        let Some(obj) = condition.as_object() else {
            return true;
        };
        let key = obj
            .get("variable")
            .or_else(|| obj.get("path"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if key.is_empty() {
            return true;
        }
        let op = obj
            .get("operator")
            .or_else(|| obj.get("op"))
            .and_then(Value::as_str)
            .unwrap_or("eq");
        let expected = obj.get("value");
        let vars = self.runtime_variables.lock().await;
        let actual = vars.get(key);
        match op {
            "exists" => actual.is_some_and(|v| !v.is_null()),
            "neq" | "!=" => actual != expected,
            "gt" | ">" => actual.and_then(Value::as_f64) > expected.and_then(Value::as_f64),
            "lt" | "<" => match (actual.and_then(Value::as_f64), expected.and_then(Value::as_f64)) {
                (Some(a), Some(b)) => a < b,
                _ => false,
            },
            "gte" | ">=" => match (actual.and_then(Value::as_f64), expected.and_then(Value::as_f64)) {
                (Some(a), Some(b)) => a >= b,
                _ => false,
            },
            "lte" | "<=" => match (actual.and_then(Value::as_f64), expected.and_then(Value::as_f64)) {
                (Some(a), Some(b)) => a <= b,
                _ => false,
            },
            _ => actual == expected,
        }
    }

    fn is_rooted_local_drive_path(trimmed: &str) -> bool {
        if trimmed.starts_with(r"\\") || trimmed.starts_with("//") {
            return false;
        }
        let bytes = trimmed.as_bytes();
        bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/')
            && !trimmed[2..].contains(':')
    }

    fn validate_local_shell_target(raw: &str, block_executables: bool) -> Result<PathBuf, String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err("Path is required".to_owned());
        }
        if !Self::is_rooted_local_drive_path(trimmed) {
            return Err("Only absolute local drive paths are allowed".to_owned());
        }
        let pb = PathBuf::from(trimmed);
        if !pb.exists() {
            return Err("Target path does not exist".to_owned());
        }
        if block_executables {
            let ext = pb
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            const BLOCKED_EXTS: &[&str] = &[
                "exe", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "msi", "scr", "com", "pif",
                "hta", "cpl", "msc", "lnk", "wsf", "jar",
            ];
            if BLOCKED_EXTS.contains(&ext.as_str()) {
                return Err("Executable files require system.launchApplication with approval".to_owned());
            }
        }
        Ok(pb)
    }

    async fn execute_actions(
        &self,
        session_key: &str,
        actions: &[Value],
        value_override: Option<f64>,
        client_ip: &str,
        session_replies: &mut Vec<Value>,
    ) -> Result<Value, String> {
        let mut last = json!({ "status": "success" });
        for raw_action in actions {
            if raw_action.get("enabled").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            if let Some(cond) = raw_action.get("condition")
                && !cond.is_null()
                && !self.condition_matches(cond).await
            {
                continue;
            }
            let repeat = raw_action.get("repeat").and_then(Value::as_u64).unwrap_or(1).clamp(1, 100);
            let delay_ms = raw_action.get("delayMs").and_then(Value::as_u64).unwrap_or(0).min(60_000);
            let continue_on_err = raw_action
                .get("continueOnError")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let a_type = raw_action.get("type").and_then(Value::as_str).unwrap_or("");
            let mut params = raw_action
                .get("parameters")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Some(val) = value_override {
                params.insert("value".to_owned(), json!(val));
            }
            let params_val = Value::Object(params);

            for _ in 0..repeat {
                if delay_ms > 0 {
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
                match self
                    .execute_single_action(session_key, a_type, &params_val, client_ip, session_replies)
                    .await
                {
                    Ok(v) => last = v,
                    Err(e) => {
                        if !continue_on_err {
                            return Err(e);
                        }
                    }
                }
            }
        }
        Ok(last)
    }

    async fn execute_single_action(
        &self,
        session_key: &str,
        action_type: &str,
        params: &Value,
        client_ip: &str,
        session_replies: &mut Vec<Value>,
    ) -> Result<Value, String> {
        let num_val = params.get("value").and_then(Value::as_f64).map(|v| v.round().clamp(0.0, 100.0) as u8);
        match action_type {
            "media.playPause" => self.executor.execute_media("PLAY_PAUSE", None).await,
            "media.next" => self.executor.execute_media("NEXT_TRACK", None).await,
            "media.previous" => self.executor.execute_media("PREV_TRACK", None).await,
            "audio.volumeUp" => self.executor.execute_media("VOL_UP", Some(5)).await,
            "audio.volumeDown" => self.executor.execute_media("VOL_DOWN", Some(5)).await,
            "audio.mute" | "audio.masterMute" => self.executor.execute_media("VOL_MUTE", None).await,
            "audio.setVolume" | "audio.masterVolume" => {
                let target = num_val.ok_or("Volume value is required")?;
                self.executor.execute_media("VOL_SET", Some(target)).await
            }
            "power.lock" => Ok(win_input::handle_power_action("LOCK")),
            "power.sleep" => Ok(win_input::handle_power_action("SLEEP")),
            "power.shutdown" => Ok(win_input::handle_power_action("SHUTDOWN")),
            "power.restart" => Ok(win_input::handle_power_action("REBOOT")),
            "window.closeActive" => Ok(win_input::handle_power_action("CLOSE_WINDOW")),
            "stream.start" => {
                self.executor.set_stream_enabled(true).await?;
                Ok(json!({ "status": "success" }))
            }
            "stream.stop" => {
                self.executor.set_stream_enabled(false).await?;
                Ok(json!({ "status": "success" }))
            }
            "input.key" => {
                let key = params.get("key").and_then(Value::as_str).unwrap_or("");
                let key_owned = key.to_owned();
                let _ = tokio::task::spawn_blocking(move || {
                    win_input::handle_key_press_full(Some(&key_owned), None, &[]);
                })
                .await;
                Ok(json!({ "status": "success" }))
            }
            "input.hotkey" => {
                let keys: Vec<String> = params
                    .get("keys")
                    .and_then(Value::as_array)
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(ToOwned::to_owned)).collect())
                    .unwrap_or_default();
                let _ = tokio::task::spawn_blocking(move || {
                    win_input::send_hotkey_vks(&keys);
                })
                .await;
                Ok(json!({ "status": "success" }))
            }
            "input.sequence" => {
                let steps = params
                    .get("keys")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for step in steps {
                    if let Some(arr) = step.as_array() {
                        let keys: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(ToOwned::to_owned)).collect();
                        let _ = tokio::task::spawn_blocking(move || win_input::send_hotkey_vks(&keys)).await;
                    } else if let Some(s) = step.as_str() {
                        let owned = s.to_owned();
                        let _ = tokio::task::spawn_blocking(move || {
                            win_input::handle_key_press_full(Some(&owned), None, &[]);
                        })
                        .await;
                    }
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Ok(json!({ "status": "success" }))
            }
            "input.text" | "system.typeText" => {
                let text = params.get("text").and_then(Value::as_str).unwrap_or("").to_owned();
                let _ = tokio::task::spawn_blocking(move || win_input::send_unicode_text(&text)).await;
                Ok(json!({ "status": "success" }))
            }
            "system.openUrl" => {
                let raw = params.get("url").and_then(Value::as_str).unwrap_or("");
                let parsed = url::Url::parse(raw).map_err(|_| "Invalid URL".to_owned())?;
                if !matches!(parsed.scheme(), "http" | "https") {
                    return Err("Only http:// and https:// URLs are supported".to_owned());
                }
                let s = parsed.to_string();
                tokio::task::spawn_blocking(move || win_input::shell_open_target(&s))
                    .await
                    .map_err(|e| e.to_string())??;
                Ok(json!({ "status": "success" }))
            }
            "system.openFile" => {
                let raw = params.get("path").and_then(Value::as_str).unwrap_or("");
                let pb = Self::validate_local_shell_target(raw, true)?;
                let target = pb.to_string_lossy().into_owned();
                tokio::task::spawn_blocking(move || win_input::shell_open_target(&target))
                    .await
                    .map_err(|e| e.to_string())??;
                Ok(json!({ "status": "success" }))
            }
            "system.openFolder" => {
                let raw = params.get("path").and_then(Value::as_str).unwrap_or("");
                let reveal = params.get("reveal").and_then(Value::as_bool).unwrap_or(false);
                let pb = Self::validate_local_shell_target(raw, false)?;
                let target = pb.to_string_lossy().into_owned();
                tokio::task::spawn_blocking(move || {
                    if reveal {
                        win_input::reveal_in_explorer(&target)
                    } else if pb.is_dir() {
                        win_input::shell_open_target(&target)
                    } else {
                        win_input::reveal_in_explorer(&target)
                    }
                })
                .await
                .map_err(|e| e.to_string())??;
                Ok(json!({ "status": "success" }))
            }
            "system.launchApplication" | "system.runProgram" => {
                let p = params.get("path").and_then(Value::as_str).unwrap_or("").trim().to_owned();
                let pb = Self::validate_local_shell_target(&p, false)?;
                let approval = self
                    .approval_gate
                    .approve(PairingRequest {
                        request_id: generate_id("deck-exec"),
                        client_ip: client_ip.to_owned(),
                        device_model: format!("Запуск: {p}"),
                    })
                    .await;
                if !approval.approved {
                    return Err("Application launch declined on PC".to_owned());
                }
                let args: Vec<String> = params
                    .get("arguments")
                    .and_then(Value::as_array)
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(ToOwned::to_owned)).take(64).collect())
                    .unwrap_or_default();
                let working_dir = params
                    .get("workingDirectory")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| Self::is_rooted_local_drive_path(s))
                    .map(PathBuf::from)
                    .filter(|wd| wd.is_dir());
                let ext = pb
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                let direct_exec = matches!(ext.as_str(), "exe" | "com" | "bat" | "cmd");
                tokio::task::spawn_blocking(move || {
                    if !direct_exec && args.is_empty() {
                        return win_input::shell_open_target(&p)
                            .map_err(|e| format!("Failed to start program: {e}"));
                    }
                    let mut cmd = std::process::Command::new(&p);
                    cmd.args(&args);
                    if let Some(wd) = working_dir {
                        cmd.current_dir(wd);
                    }
                    cmd.spawn()
                        .map(|_| ())
                        .map_err(|e| format!("Failed to start program: {e}"))
                })
                .await
                .map_err(|e| e.to_string())??;
                Ok(json!({ "status": "success" }))
            }
            "window.minimize" | "window.maximize" | "window.restore" | "window.close" => {
                let sub = action_type.trim_start_matches("window.").to_owned();
                tokio::task::spawn_blocking(move || win_input::window_command(&sub))
                    .await
                    .map_err(|e| e.to_string())??;
                Ok(json!({ "status": "success" }))
            }
            "navigation.page" | "navigation.deck" | "navigation.back" => {
                if let Some(msg) = self
                    .navigate_session(
                        session_key,
                        params.get("deckId").and_then(Value::as_str),
                        params.get("pageId").and_then(Value::as_str),
                        action_type == "navigation.back",
                    )
                    .await
                {
                    session_replies.push(msg);
                }
                Ok(json!({ "status": "success" }))
            }
            t if t.starts_with("obs.") => {
                let (req_type, req_data) = match t {
                    "obs.stream.start" => ("StartStream", json!({})),
                    "obs.stream.stop" => ("StopStream", json!({})),
                    "obs.stream.toggle" => ("ToggleStream", json!({})),
                    "obs.record.start" => ("StartRecord", json!({})),
                    "obs.record.stop" => ("StopRecord", json!({})),
                    "obs.record.toggle" => ("ToggleRecord", json!({})),
                    "obs.record.pause" => ("PauseRecord", json!({})),
                    "obs.record.resume" => ("ResumeRecord", json!({})),
                    "obs.replay.save" => ("SaveReplayBuffer", json!({})),
                    "obs.scene.set" => (
                        "SetCurrentProgramScene",
                        json!({ "sceneName": params.get("sceneName").and_then(Value::as_str).unwrap_or("") }),
                    ),
                    "obs.source.mute" => (
                        "SetInputMute",
                        json!({
                            "inputName": params.get("inputName").and_then(Value::as_str).unwrap_or(""),
                            "inputMuted": params.get("muted").and_then(Value::as_bool).unwrap_or(false)
                        }),
                    ),
                    "obs.studioMode" => (
                        "SetStudioModeEnabled",
                        json!({ "studioModeEnabled": params.get("enabled").and_then(Value::as_bool).unwrap_or(false) }),
                    ),
                    "obs.transition" => (
                        "SetCurrentSceneTransition",
                        json!({ "transitionName": params.get("transitionName").and_then(Value::as_str).unwrap_or("") }),
                    ),
                    "obs.source.visibility" => (
                        "SetSceneItemEnabled",
                        json!({
                            "sceneName": params.get("sceneName").and_then(Value::as_str).unwrap_or(""),
                            "sceneItemId": params.get("sceneItemId").and_then(Value::as_i64).unwrap_or(0),
                            "sceneItemEnabled": params.get("enabled").and_then(Value::as_bool).unwrap_or(true)
                        }),
                    ),
                    _ => return Err(format!("Unsupported OBS action: {t}")),
                };
                self.obs.request(req_type, req_data).await
            }
            _ => Err(format!("Unsupported Deck action: {action_type}")),
        }
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
