//! Secret storage commands — thin wrapper around `SecretStorage`.
//!
//! Secret values live in the OS keyring. The SQLite secret_index records owned
//! keys and explicit non-secret metadata. New secret writes never fall back
//! to plaintext.

use std::sync::Arc;

use sc_code_auth::SecretStorage;
use tauri::{AppHandle, Manager};

pub struct SecretsStore {
    pub(crate) inner: SecretStorage,
    extension_profile_id: String,
}

impl SecretsStore {
    pub(crate) fn new(storage: SecretStorage, home: &std::path::Path) -> Result<Self, String> {
        const ID_KEY: &str = "sc-code.extension-secret-profile-id.v1";
        let existing = storage.get_plain(ID_KEY).map_err(|e| e.to_string())?;
        let extension_profile_id = select_extension_profile_id(home, existing.as_deref())?;
        if existing.is_none() {
            storage
                .set_plain(ID_KEY, &extension_profile_id)
                .map_err(|e| e.to_string())?;
        }
        Ok(Self {
            inner: storage,
            extension_profile_id,
        })
    }
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let data_dir = crate::app_dirs::app_data_dir();
    // state.vscdb -> ItemTable, matching how the VS Code platform (and
    // Cursor, which this layout is modeled on) persist user-scoped state.
    let db_path = data_dir
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");
    let storage = SecretStorage::open(db_path).map_err(|e| e.to_string())?;
    app.manage(Arc::new(SecretsStore::new(storage, &data_dir)?));
    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn secret_get(
    store: tauri::State<'_, Arc<SecretsStore>>,
    key: String,
) -> Result<Option<String>, String> {
    store.inner.get(&key).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn secret_set(
    store: tauri::State<'_, Arc<SecretsStore>>,
    key: String,
    value: String,
) -> Result<(), String> {
    store.inner.set(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn secret_delete(
    store: tauri::State<'_, Arc<SecretsStore>>,
    key: String,
) -> Result<(), String> {
    store.inner.delete(&key).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn secret_keys(store: tauri::State<'_, Arc<SecretsStore>>) -> Result<Vec<String>, String> {
    store.inner.keys().map_err(|e| e.to_string())
}

// Namespace extension secrets by profile, extension ID and key. This prevents
// accidental cross-extension/profile collisions, not a sandbox for native Node code.
fn profile_hash(home: &std::path::Path) -> String {
    use sha2::{Digest, Sha256};
    let resolved = dunce::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    let profile = resolved.to_string_lossy();
    #[cfg(windows)]
    let profile = profile.to_ascii_lowercase();
    format!("{:x}", Sha256::digest(profile.as_bytes()))
}

fn select_extension_profile_id(
    home: &std::path::Path,
    existing: Option<&str>,
) -> Result<String, String> {
    if let Some(id) = existing {
        if id.len() != 64 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid extension secret profile identity".into());
        }
        return Ok(id.to_string());
    }
    Ok(profile_hash(home))
}

fn extension_secret_key(profile_id: &str, extension_id: &str, key: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let id = extension_id.to_ascii_lowercase();
    let (publisher, name) = id.split_once('.').ok_or("Invalid extension ID")?;
    let valid = |part: &str, dotted: bool| {
        !part.is_empty()
            && part.as_bytes()[0].is_ascii_alphanumeric()
            && part.bytes().all(|c| {
                c.is_ascii_alphanumeric() || c == b'-' || (dotted && matches!(c, b'.' | b'_'))
            })
    };
    if id.len() > 255 || !valid(publisher, false) || !valid(name, true) {
        return Err("Invalid extension ID".into());
    }
    if key.is_empty() || key.len() > 8192 {
        return Err("Invalid secret key".into());
    }
    Ok(format!(
        "extension/v1/{profile_id}/{id}/{:x}",
        Sha256::digest(key.as_bytes())
    ))
}

#[tauri::command]
pub fn extension_secret(
    store: tauri::State<'_, Arc<SecretsStore>>,
    extension_id: String,
    operation: String,
    key: String,
    value: Option<String>,
) -> Result<Option<String>, String> {
    let owned_key = extension_secret_key(&store.extension_profile_id, &extension_id, &key)?;
    match operation.as_str() {
        "get" => store
            .inner
            .get(&owned_key)
            .map_err(|_| "OS keyring read failed".into()),
        "store" => {
            let value = value.ok_or("Missing secret value")?;
            store
                .inner
                .set(&owned_key, &value)
                .map_err(|_| "OS keyring write failed; no plaintext fallback")?;
            Ok(None)
        }
        "delete" => {
            store
                .inner
                .delete(&owned_key)
                .map_err(|_| "OS keyring delete failed")?;
            Ok(None)
        }
        _ => Err("Unsupported extension secret operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::{extension_secret_key, profile_hash, select_extension_profile_id};
    use std::path::Path;

    #[test]
    fn secret_namespaces_separate_profiles_extensions_and_keys() {
        let a = extension_secret_key(&profile_hash(Path::new("profile-a")), "sample.one", "token")
            .unwrap();
        assert_ne!(
            a,
            extension_secret_key(&profile_hash(Path::new("profile-b")), "sample.one", "token")
                .unwrap()
        );
        assert_ne!(
            a,
            extension_secret_key(&profile_hash(Path::new("profile-a")), "sample.two", "token")
                .unwrap()
        );
        assert_ne!(
            a,
            extension_secret_key(
                &profile_hash(Path::new("profile-a")),
                "sample.one",
                "password"
            )
            .unwrap()
        );
        assert_eq!(
            a,
            extension_secret_key(&profile_hash(Path::new("profile-a")), "SAMPLE.ONE", "token")
                .unwrap()
        );
        assert!(!a.contains("token"));
    }

    #[test]
    fn invalid_secret_namespace_is_rejected() {
        for id in ["../other", "a/b.c", "a.b/c", "a", ".a", "a."] {
            assert!(
                extension_secret_key(&profile_hash(Path::new("profile")), id, "token").is_err()
            );
        }
        assert!(
            extension_secret_key(&profile_hash(Path::new("profile")), "sample.one", "").is_err()
        );
    }
}
