use std::collections::HashMap;
use std::time::{Duration, Instant};

use aether_protocol::{MAX_FILE_BYTES, MAX_FILE_CHUNK_BYTES, validate_transfer_id};
use thiserror::Error;

pub const MAX_FAILED_AUTH_ATTEMPTS: u8 = 3;
pub const AUTH_COOLDOWN: Duration = Duration::from_secs(60);
pub const MAX_CONCURRENT_TRANSFERS: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthDecision {
    Allowed,
    Rejected { remaining_attempts: u8 },
    Blocked { retry_after: Duration },
}

#[derive(Debug, Default)]
pub struct AuthRateLimiter {
    attempts: HashMap<String, AttemptState>,
}

#[derive(Debug)]
struct AttemptState {
    failures: u8,
    blocked_until: Option<Instant>,
    last_attempt: Instant,
}

impl AuthRateLimiter {
    pub fn record(&mut self, identity: &str, credential_valid: bool, now: Instant) -> AuthDecision {
        self.attempts.retain(|_, s| {
            if let Some(until) = s.blocked_until {
                until > now
            } else {
                now.duration_since(s.last_attempt) < AUTH_COOLDOWN
            }
        });

        let state = self
            .attempts
            .entry(identity.to_owned())
            .or_insert(AttemptState {
                failures: 0,
                blocked_until: None,
                last_attempt: now,
            });
        state.last_attempt = now;

        if let Some(until) = state.blocked_until {
            if until > now {
                return AuthDecision::Blocked {
                    retry_after: until.duration_since(now),
                };
            }
            state.failures = 0;
            state.blocked_until = None;
        }

        if credential_valid {
            self.attempts.remove(identity);
            return AuthDecision::Allowed;
        }

        state.failures = state.failures.saturating_add(1);
        if state.failures >= MAX_FAILED_AUTH_ATTEMPTS {
            state.blocked_until = Some(now + AUTH_COOLDOWN);
            AuthDecision::Blocked {
                retry_after: AUTH_COOLDOWN,
            }
        } else {
            AuthDecision::Rejected {
                remaining_attempts: MAX_FAILED_AUTH_ATTEMPTS - state.failures,
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferState {
    pub id: String,
    pub declared_size: u64,
    pub chunk_size: usize,
    pub received_bytes: u64,
}

#[derive(Debug, Default)]
pub struct TransferRegistry {
    transfers: HashMap<String, TransferState>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransferError {
    #[error("invalid transfer id: {0}")]
    InvalidId(String),
    #[error("file exceeds 500 MiB")]
    FileTooLarge,
    #[error("invalid chunk size")]
    InvalidChunkSize,
    #[error("too many concurrent transfers")]
    TooManyTransfers,
    #[error("duplicate transfer id")]
    Duplicate,
    #[error("unknown transfer")]
    Unknown,
    #[error("chunk is out of order or exceeds the declared file size")]
    InvalidOffset,
    #[error("file is incomplete")]
    Incomplete,
}

impl TransferRegistry {
    pub fn start(
        &mut self,
        id: String,
        declared_size: u64,
        chunk_size: usize,
    ) -> Result<(), TransferError> {
        validate_transfer_id(&id).map_err(TransferError::InvalidId)?;
        if declared_size > MAX_FILE_BYTES {
            return Err(TransferError::FileTooLarge);
        }
        if chunk_size == 0 || chunk_size > MAX_FILE_CHUNK_BYTES {
            return Err(TransferError::InvalidChunkSize);
        }
        if self.transfers.len() >= MAX_CONCURRENT_TRANSFERS {
            return Err(TransferError::TooManyTransfers);
        }
        if self.transfers.contains_key(&id) {
            return Err(TransferError::Duplicate);
        }
        self.transfers.insert(
            id.clone(),
            TransferState {
                id,
                declared_size,
                chunk_size,
                received_bytes: 0,
            },
        );
        Ok(())
    }

    pub fn accept_chunk(
        &mut self,
        id: &str,
        offset: u64,
        bytes: usize,
    ) -> Result<u64, TransferError> {
        let transfer = self.transfers.get_mut(id).ok_or(TransferError::Unknown)?;
        let end = offset
            .checked_add(bytes as u64)
            .ok_or(TransferError::InvalidOffset)?;
        if offset != transfer.received_bytes
            || bytes > transfer.chunk_size
            || end > transfer.declared_size
        {
            self.transfers.remove(id);
            return Err(TransferError::InvalidOffset);
        }
        transfer.received_bytes = end;
        Ok(end)
    }

    pub fn finish(&mut self, id: &str) -> Result<TransferState, TransferError> {
        let transfer = self.transfers.remove(id).ok_or(TransferError::Unknown)?;
        if transfer.received_bytes != transfer.declared_size {
            return Err(TransferError::Incomplete);
        }
        Ok(transfer)
    }

    pub fn cancel(&mut self, id: &str) -> bool {
        self.transfers.remove(id).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_three_failed_auth_attempts_and_recovers() {
        let now = Instant::now();
        let mut limiter = AuthRateLimiter::default();
        assert_eq!(
            limiter.record("phone", false, now),
            AuthDecision::Rejected {
                remaining_attempts: 2
            }
        );
        assert_eq!(
            limiter.record("phone", false, now),
            AuthDecision::Rejected {
                remaining_attempts: 1
            }
        );
        assert_eq!(
            limiter.record("phone", false, now),
            AuthDecision::Blocked {
                retry_after: AUTH_COOLDOWN
            }
        );
        assert!(matches!(
            limiter.record("phone", true, now),
            AuthDecision::Blocked { .. }
        ));
        assert_eq!(
            limiter.record("phone", true, now + AUTH_COOLDOWN),
            AuthDecision::Allowed
        );
    }

    #[test]
    fn enforces_order_and_exact_size_for_file_transfer() {
        let mut registry = TransferRegistry::default();
        registry.start("transfer-1".to_owned(), 5, 4).unwrap();
        assert_eq!(registry.accept_chunk("transfer-1", 0, 4), Ok(4));
        assert_eq!(registry.accept_chunk("transfer-1", 4, 1), Ok(5));
        assert_eq!(registry.finish("transfer-1").unwrap().received_bytes, 5);
    }

    #[test]
    fn drops_transfer_after_out_of_order_chunk() {
        let mut registry = TransferRegistry::default();
        registry.start("transfer-1".to_owned(), 8, 4).unwrap();
        assert_eq!(
            registry.accept_chunk("transfer-1", 4, 4),
            Err(TransferError::InvalidOffset)
        );
        assert_eq!(registry.finish("transfer-1"), Err(TransferError::Unknown));
    }

    #[test]
    fn rejects_duplicate_transfer_id() {
        let mut registry = TransferRegistry::default();
        registry.start("same".to_owned(), 1, 1).unwrap();
        assert_eq!(
            registry.start("same".to_owned(), 1, 1),
            Err(TransferError::Duplicate)
        );
    }
}
