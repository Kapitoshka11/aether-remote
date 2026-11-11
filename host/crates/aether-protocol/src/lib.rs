use std::collections::BTreeMap;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub const PROTOCOL_VERSION: &str = "2.0";
pub const MAX_JSON_MESSAGE_BYTES: usize = 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_FILE_CHUNK_BYTES: usize = 256 * 1024;
pub const DEFAULT_FILE_CHUNK_BYTES: usize = 64 * 1024;
pub const MAX_CLIPBOARD_TEXT_CHARS: usize = 100_000;
pub const MAX_CAPABILITIES: usize = 32;
pub const MAX_TRANSFER_ID_CHARS: usize = 128;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub action: String,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRequest {
    pub action: String,
    #[serde(default)]
    pub pin: String,
    #[serde(default)]
    pub session_token: String,
    #[serde(default)]
    pub device_model: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStart {
    pub action: String,
    #[serde(default)]
    pub file_id: String,
    pub file_name: String,
    pub file_size: u64,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChunk {
    pub action: String,
    pub file_id: String,
    #[serde(default)]
    pub chunk_index: Option<u64>,
    #[serde(default)]
    pub offset: Option<u64>,
    #[serde(alias = "chunk", alias = "base64")]
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEnd {
    pub action: String,
    pub file_id: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("message exceeds the 1 MiB protocol limit")]
    MessageTooLarge,
    #[error("message is not valid JSON: {0}")]
    InvalidJson(String),
    #[error("action is missing or empty")]
    MissingAction,
    #[error("invalid message for {action}: {reason}")]
    InvalidAction { action: String, reason: String },
}

pub fn parse_and_validate(input: &str) -> Result<Message, ProtocolError> {
    if input.len() > MAX_JSON_MESSAGE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    let message: Message = serde_json::from_str(input)
        .map_err(|error| ProtocolError::InvalidJson(error.to_string()))?;
    if message.action.trim().is_empty() {
        return Err(ProtocolError::MissingAction);
    }
    validate_message(&message)?;
    Ok(message)
}

pub fn validate_message(message: &Message) -> Result<(), ProtocolError> {
    let encoded =
        serde_json::to_vec(message).map_err(|error| invalid(&message.action, error.to_string()))?;
    if encoded.len() > MAX_JSON_MESSAGE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }

    match message.action.as_str() {
        "AUTH" => {
            reject_unexpected_fields(
                message,
                &["pin", "sessionToken", "deviceModel", "capabilities"],
            )?;
            let auth: AuthRequest = from_message(message)?;
            if auth.capabilities.len() > MAX_CAPABILITIES {
                return Err(invalid("AUTH", "too many capabilities"));
            }
            if auth.pin.chars().count() > 32 || auth.session_token.chars().count() > 128 {
                return Err(invalid("AUTH", "credential field exceeds its size limit"));
            }
            if auth.device_model.chars().count() > 80 {
                return Err(invalid("AUTH", "deviceModel exceeds 80 characters"));
            }
            if auth
                .capabilities
                .iter()
                .any(|value| value.chars().count() > 64)
            {
                return Err(invalid("AUTH", "capability exceeds 64 characters"));
            }
        }
        "PING" => reject_unexpected_fields(message, &["timestamp"])?,
        "GET_TELEMETRY" => reject_unexpected_fields(message, &[])?,
        "CLIPBOARD" | "WRITE_CLIPBOARD" => {
            reject_unexpected_fields(message, &["command", "text", "message", "content"])?;
            let text = string_field(message, &["text", "message", "content"]);
            if text.chars().count() > MAX_CLIPBOARD_TEXT_CHARS {
                return Err(invalid(
                    &message.action,
                    "clipboard text exceeds 100000 characters",
                ));
            }
        }
        "MEDIA" => {
            reject_unexpected_fields(message, &["command", "type", "val", "value"])?;
            validate_optional_short_strings(message, &["command", "type"], 64)?;
            for field in ["val", "value"] {
                if let Some(value) = message.fields.get(field)
                    && !value.is_number()
                {
                    return Err(invalid("MEDIA", format!("{field} must be numeric")));
                }
            }
        }
        "DECK_SYNC_REQUEST" => reject_unexpected_fields(message, &["revision", "stateRevision"])?,
        "DECK_ASSET_REQUEST" => {
            reject_unexpected_fields(message, &["hash"])?;
            validate_optional_short_strings(message, &["hash"], 128)?;
        }
        "DECK_NAVIGATE" => {
            reject_unexpected_fields(message, &["deckId", "pageId", "back"])?;
            validate_optional_short_strings(message, &["deckId", "pageId"], 128)?;
        }
        "DECK_BACK" => reject_unexpected_fields(message, &["deckId", "pageId"])?,
        "DECK_TRIGGER" => {
            reject_unexpected_fields(
                message,
                &["triggerId", "revision", "deckId", "pageId", "controlId"],
            )?;
            validate_optional_short_strings(
                message,
                &["triggerId", "deckId", "pageId", "controlId"],
                128,
            )?;
        }
        "DECK_SLIDER" => {
            if !message.fields.get("triggerId").and_then(Value::as_str)
                .is_some_and(|id| (1..=128).contains(&id.chars().count())) {
                return Err(invalid("DECK_SLIDER", "triggerId must contain 1 to 128 characters"));
            }
            reject_unexpected_fields(
                message,
                &[
                    "triggerId",
                    "revision",
                    "deckId",
                    "pageId",
                    "controlId",
                    "value",
                    "sequence",
                ],
            )?;
            validate_optional_short_strings(
                message,
                &["triggerId", "deckId", "pageId", "controlId"],
                128,
            )?;
        }
        "FILE_START" => {
            reject_unexpected_fields(
                message,
                &[
                    "fileId",
                    "fileName",
                    "fileSize",
                    "chunkSize",
                    "mimeType",
                    "totalChunks",
                ],
            )?;
            validate_file_start(&from_message(message)?)?;
        }
        "FILE_CHUNK" => {
            reject_unexpected_fields(
                message,
                &[
                    "fileId",
                    "chunkIndex",
                    "offset",
                    "data",
                    "chunk",
                    "base64",
                    "progress",
                ],
            )?;
            validate_file_chunk(&from_message(message)?)?;
        }
        "FILE_END" | "FILE_CANCEL" => {
            let allowed = if message.action == "FILE_END" {
                &["fileId", "fileName", "fileSize"][..]
            } else {
                &["fileId", "error"][..]
            };
            reject_unexpected_fields(message, allowed)?;
            let end: FileEnd = from_message(message)?;
            validate_transfer_id(&end.file_id)
                .map_err(|reason| invalid(&message.action, reason))?;
        }
        "MOUSE_MOVE"
        | "MOUSE_CLICK"
        | "MOUSE_SCROLL"
        | "REMOTE_MOUSE_MOVE"
        | "REMOTE_MOUSE_CLICK"
        | "REMOTE_MOUSE_SCROLL"
        | "KEY_PRESS"
        | "REMOTE_KEY_PRESS"
        | "STREAM_FRAME"
        | "FRAME_ACK"
        | "AUDIO_STREAM"
        | "POWER"
        | "SYSTEM"
        | "TAKE_SCREENSHOT"
        | "GET_SCREENSHOT"
        | "WAKE_ENROLL"
        | "ACCOUNT_HELLO"
        | "ACCOUNT_PROOF"
        | "KILL_PROCESS"
        | "SEND_TOAST"
        | "POWERSHELL"
        | "FILE_START_ACK"
        | "FILE_CHUNK_ACK"
        | "FILE_END_ACK"
        | "FILE_CANCEL_ACK" => {}
        _ => return Err(invalid(&message.action, "unsupported action")),
    }
    Ok(())
}

fn reject_unexpected_fields(message: &Message, allowed: &[&str]) -> Result<(), ProtocolError> {
    if let Some(field) = message
        .fields
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        return Err(invalid(
            &message.action,
            format!("unexpected field: {field}"),
        ));
    }
    Ok(())
}

pub fn validate_file_start(start: &FileStart) -> Result<(), ProtocolError> {
    if !start.file_id.is_empty() {
        validate_transfer_id(&start.file_id).map_err(|reason| invalid("FILE_START", reason))?;
    }
    if start.file_name.trim().is_empty() || start.file_name.chars().count() > 255 {
        return Err(invalid("FILE_START", "invalid fileName"));
    }
    if start.file_name.contains('/')
        || start.file_name.contains('\\')
        || start.file_name == "."
        || start.file_name == ".."
    {
        return Err(invalid("FILE_START", "fileName must not contain a path"));
    }
    if start.file_size > MAX_FILE_BYTES {
        return Err(invalid("FILE_START", "fileSize exceeds 500 MiB"));
    }
    if start.chunk_size == 0 || start.chunk_size > MAX_FILE_CHUNK_BYTES {
        return Err(invalid(
            "FILE_START",
            "chunkSize must be between 1 and 262144",
        ));
    }
    Ok(())
}

pub fn validate_file_chunk(chunk: &FileChunk) -> Result<(), ProtocolError> {
    validate_transfer_id(&chunk.file_id).map_err(|reason| invalid("FILE_CHUNK", reason))?;
    let decoded = STANDARD
        .decode(&chunk.data)
        .map_err(|_| invalid("FILE_CHUNK", "data is not strict base64"))?;
    if decoded.len() > MAX_FILE_CHUNK_BYTES {
        return Err(invalid("FILE_CHUNK", "decoded chunk exceeds 256 KiB"));
    }
    Ok(())
}

pub fn validate_transfer_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.chars().count() > MAX_TRANSFER_ID_CHARS {
        return Err("fileId length must be between 1 and 128".to_owned());
    }
    if !id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("fileId contains unsafe characters".to_owned());
    }
    Ok(())
}

fn from_message<T>(message: &Message) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    let value = serde_json::to_value(message)
        .map_err(|error| invalid(&message.action, error.to_string()))?;
    serde_json::from_value(value).map_err(|error| invalid(&message.action, error.to_string()))
}

fn string_field<'a>(message: &'a Message, names: &[&str]) -> &'a str {
    names
        .iter()
        .find_map(|name| message.fields.get(*name).and_then(Value::as_str))
        .unwrap_or_default()
}

fn validate_optional_short_strings(
    message: &Message,
    names: &[&str],
    maximum: usize,
) -> Result<(), ProtocolError> {
    for name in names {
        if let Some(value) = message.fields.get(*name)
            && value
                .as_str()
                .is_none_or(|text| text.chars().count() > maximum)
        {
            return Err(invalid(
                &message.action,
                format!("{name} must be a string no longer than {maximum} characters"),
            ));
        }
    }
    Ok(())
}

fn default_chunk_size() -> usize {
    DEFAULT_FILE_CHUNK_BYTES
}

fn invalid(action: &str, reason: impl Into<String>) -> ProtocolError {
    ProtocolError::InvalidAction {
        action: action.to_owned(),
        reason: reason.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_android_auth_shape_and_preserves_capabilities() {
        let message = parse_and_validate(
            r#"{"action":"AUTH","pin":"123456","deviceModel":"Pixel","capabilities":["file-transfer-v2","clipboard-history-v1"]}"#,
        )
        .unwrap();
        let auth: AuthRequest = from_message(&message).unwrap();
        assert_eq!(auth.device_model, "Pixel");
        assert_eq!(auth.capabilities.len(), 2);
    }

    #[test]
    fn rejects_unknown_actions_and_unexpected_fields() {
        assert!(matches!(
            parse_and_validate(r#"{"action":"FUTURE_ACTION","newField":42}"#),
            Err(ProtocolError::InvalidAction { .. })
        ));
        assert!(matches!(
            parse_and_validate(r#"{"action":"PING","timestamp":1,"script":"whoami"}"#),
            Err(ProtocolError::InvalidAction { .. })
        ));
    }

    #[test]
    fn rejects_unsafe_file_names_and_transfer_ids() {
        let unsafe_name = parse_and_validate(
            r#"{"action":"FILE_START","fileId":"ok","fileName":"../secret.txt","fileSize":4,"chunkSize":4}"#,
        );
        assert!(matches!(
            unsafe_name,
            Err(ProtocolError::InvalidAction { .. })
        ));

        let unsafe_id = parse_and_validate(r#"{"action":"FILE_END","fileId":"../../escape"}"#);
        assert!(matches!(
            unsafe_id,
            Err(ProtocolError::InvalidAction { .. })
        ));
    }

    #[test]
    fn accepts_strict_bounded_file_chunk() {
        let message = parse_and_validate(
            r#"{"action":"FILE_CHUNK","fileId":"transfer-1","chunkIndex":0,"data":"aGVsbG8="}"#,
        );
        assert!(message.is_ok());
    }

    #[test]
    fn accepts_existing_deck_and_media_wire_shapes() {
        for json in [
            r#"{"action":"DECK_SYNC_REQUEST"}"#,
            r#"{"action":"DECK_ASSET_REQUEST","hash":"abc123"}"#,
            r#"{"action":"DECK_NAVIGATE","deckId":"main","pageId":"home"}"#,
            r#"{"action":"DECK_TRIGGER","triggerId":"trigger-1","revision":2,"deckId":"main","pageId":"home","controlId":"play"}"#,
            r#"{"action":"DECK_SLIDER","triggerId":"trigger-2","revision":2,"deckId":"main","pageId":"home","controlId":"volume","value":42.0,"sequence":3}"#,
            r#"{"action":"MEDIA","command":"VOL_SET","type":"VOLUME_SET","val":42,"value":42}"#,
        ] {
            assert!(parse_and_validate(json).is_ok(), "rejected {json}");
        }
    }

    #[test]
    fn deck_slider_requires_non_empty_trigger_id() {
        for json in [
            r#"{"action":"DECK_SLIDER","revision":2,"deckId":"main","pageId":"home","controlId":"volume","value":42.0,"sequence":3}"#,
            r#"{"action":"DECK_SLIDER","triggerId":"","revision":2,"deckId":"main","pageId":"home","controlId":"volume","value":42.0,"sequence":3}"#,
        ] {
            assert!(parse_and_validate(json).is_err(), "accepted {json}");
        }
    }

    #[test]
    fn rejects_malformed_base64_and_oversized_clipboard() {
        let malformed = parse_and_validate(
            r#"{"action":"FILE_CHUNK","fileId":"transfer-1","chunkIndex":0,"data":"%%%"}"#,
        );
        assert!(matches!(
            malformed,
            Err(ProtocolError::InvalidAction { .. })
        ));

        let text = "x".repeat(MAX_CLIPBOARD_TEXT_CHARS + 1);
        let clipboard = serde_json::json!({"action": "CLIPBOARD_ITEM", "text": text}).to_string();
        assert!(matches!(
            parse_and_validate(&clipboard),
            Err(ProtocolError::InvalidAction { .. })
        ));
    }

    #[test]
    fn rejects_message_over_one_mebibyte_before_json_parsing() {
        let input = "x".repeat(MAX_JSON_MESSAGE_BYTES + 1);
        assert_eq!(
            parse_and_validate(&input),
            Err(ProtocolError::MessageTooLarge)
        );
    }
}
