//! Generic secret storage for ScCode.
//!
//! Despite the crate name, this has nothing to do with authentication —
//! ScCode has no sign-in, so there are no tokens to manage. It's a plain
//! key-value secret store used for things like provider API keys and
//! base-URL overrides (see `commands::providers` and `commands::secrets`
//! in the `sc-code` crate); callers pick their own keys, there's no fixed
//! namespace.
//!
//! See `storage` for the keyring-backed implementation and its `SQLite`
//! index. Secret operations never fall back to plaintext.

pub mod storage;

pub use storage::{SecretStorage, StorageError};
