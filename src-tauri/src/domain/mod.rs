//! Domain models — business types with no I/O (or only file-shaped I/O
//! at the leaf). See each submodule for the entity contract:
//!
//! - [`provider`] — F1 + F2 (M2.1)
//!
//! Conventions:
//! - Every struct here is `Serialize + Deserialize` (round-trips through JSON).
//! - I/O is limited to single-file read/write (`from_json_file`,
//!   `to_json_file`). Directory-level work belongs in `services/`.
//! - All paths come in via `&Path` — never call `dirs::home_dir` directly.
//! - Validation lives on the struct itself (`Provider::validate`); services
//!   call it after `from_*` and before `to_*`.

pub mod provider;

pub use provider::{is_valid_id, Provider, ProviderError};