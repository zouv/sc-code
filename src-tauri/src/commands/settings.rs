use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use serde_json::Value;
use sidex_settings::{modify_jsonc, parse_jsonc, Settings};
use tauri::State;

pub struct SettingsStore {
    pub(crate) inner: RwLock<Settings>,
    /// Path of the user settings.json — set during app startup so user-scope
    /// updates can be persisted to disk (otherwise toggles vanish on restart).
    user_path: RwLock<Option<PathBuf>>,
    /// Serializes in-process read/modify/persist; external editors are not filesystem CAS.
    mutation: Mutex<()>,
}

impl SettingsStore {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(Settings::new()),
            user_path: RwLock::new(None),
            mutation: Mutex::new(()),
        }
    }

    pub fn load_user(&self, path: &std::path::Path) -> Result<(), String> {
        let _mutation = self.mutation.lock().map_err(|e| e.to_string())?;
        self.inner.write().map_err(|e| e.to_string())?
            .load_user(path).map_err(|e| e.to_string())?;
        self.set_user_path(path);
        Ok(())
    }

    pub fn set_user_path(&self, path: &std::path::Path) {
        if let Ok(mut p) = self.user_path.write() {
            *p = Some(path.to_path_buf());
        }
    }

    pub fn refresh_user_from_disk(&self) -> Result<(), String> {
        let _mutation = self.mutation.lock().map_err(|e| e.to_string())?;
        let path = self.user_path.read().map_err(|e| e.to_string())?.clone();
        if let Some(path) = path {
            let contents = match std::fs::read_to_string(path) {
                Ok(contents) => contents,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => "{}".to_owned(),
                Err(e) => return Err(e.to_string()),
            };
            let layer = parse_jsonc(&contents).map_err(|e| e.to_string())?;
            self.inner.write().map_err(|e| e.to_string())?
                .replace_user_layer(layer).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Commit disk first. Failed reads/validation/writes leave the in-memory layer unchanged.
    pub fn update(&self, key: &str, value: Value, scope: &str) -> Result<(), String> {
        let _mutation = self.mutation.lock().map_err(|e| e.to_string())?;
        let mut settings = self.inner.write().map_err(|e| e.to_string())?;
        match scope {
            "user" => {
                let path = self.user_path.read().map_err(|e| e.to_string())?.clone();
                if let Some(path) = path {
                    let contents = match std::fs::read_to_string(&path) {
                        Ok(contents) => contents,
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "{}".to_owned(),
                        Err(e) => return Err(e.to_string()),
                    };
                    if !parse_jsonc(&contents).map_err(|e| e.to_string())?.is_object() {
                        return Err("user settings must be a JSON object".into());
                    }
                    let updated = modify_jsonc(&contents, &[key], &value).map_err(|e| e.to_string())?;
                    let layer = parse_jsonc(&updated).map_err(|e| e.to_string())?;
                    sidex_workspace::file_ops::write_file(&path, &updated).map_err(|e| e.to_string())?;
                    settings.replace_user_layer(layer).map_err(|e| e.to_string())?;
                } else {
                    // Explicit headless/in-memory store: desktop startup always sets user_path.
                    settings.set(key, value);
                }
            }
            "workspace" => settings.set_workspace(key, value),
            _ => return Err(format!("invalid scope '{scope}': expected user or workspace")),
        }
        Ok(())
    }

    pub fn load_workspace(&self, path: &std::path::Path) -> Result<(), String> {
        self.inner
            .write()
            .map_err(|e| e.to_string())?
            .load_workspace(path)
            .map_err(|e| e.to_string())
    }
}

/// Get settings.
///
/// - `section`: if provided, returns only the value for that key
/// - `scope`: one of `"user"`, `"workspace"`, or omitted/`"merged"` for the
///   full merged object across all layers
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn settings_get(
    state: State<'_, Arc<SettingsStore>>,
    section: Option<String>,
    scope: Option<String>,
) -> Result<Value, String> {
    state.refresh_user_from_disk()?;
    let settings = state.inner.read().map_err(|e| e.to_string())?;

    if let Some(key) = section {
        return Ok(settings.get_raw(&key).cloned().unwrap_or(Value::Null));
    }

    match scope.as_deref() {
        Some("user") => Ok(settings.user_layer().clone()),
        Some("workspace") => Ok(settings.workspace_layer().clone()),
        Some("merged") | None => Ok(settings.merged()),
        Some(other) => Err(format!(
            "invalid scope '{other}': expected \"user\", \"workspace\", or \"merged\""
        )),
    }
}

/// Update a setting.
///
/// `scope` must be `"user"` or `"workspace"`.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn settings_update(
    state: State<'_, Arc<SettingsStore>>,
    key: String,
    value: Value,
    scope: String,
) -> Result<(), String> {
    state.update(&key, value, &scope)
}

/// Load settings from a JSONC file into the specified layer.
///
/// `scope` must be `"user"` or `"workspace"`.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn settings_load(
    state: State<'_, Arc<SettingsStore>>,
    path: String,
    scope: String,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    match scope.as_str() {
        "user" => state.load_user(p),
        "workspace" => state.load_workspace(p),
        _ => Err(format!(
            "invalid scope '{scope}': expected \"user\" or \"workspace\""
        )),
    }
}

/// Parse a JSONC string (strips comments & trailing commas) and return the
/// resulting JSON value. Useful for the frontend to preview or validate
/// settings files.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn settings_parse_jsonc(input: String) -> Result<Value, String> {
    parse_jsonc(&input).map_err(|e| e.to_string())
}

/// Edit a value inside a JSONC document by key-path, preserving surrounding
/// comments and formatting. Returns the modified JSONC string.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn settings_modify_jsonc(
    input: String,
    path: Vec<String>,
    value: Value,
) -> Result<String, String> {
    let refs: Vec<&str> = path.iter().map(String::as_str).collect();
    modify_jsonc(&input, &refs, &value).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::SettingsStore;

    #[test]
    fn user_update_preserves_unrelated_file_keys_and_jsonc_comments() {
        let root = std::env::temp_dir().join(format!(
            "sidex-settings-store-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("settings.json");
        let contents = r#"{
  // keep extension config
  "vac.agents": {"Agent": {"command": "agent"}},
  "editor.fontSize": 12
}
"#;
        std::fs::write(&path, contents).unwrap();

        let store = SettingsStore::new();
        store.load_user(&path).unwrap();
        store
            .update("editor.fontSize", serde_json::json!(18), "user")
            .unwrap();

        let updated = std::fs::read_to_string(&path).unwrap();
        assert!(updated.contains("// keep extension config"));
        assert!(updated.contains("\"vac.agents\""));
        assert!(updated.contains("\"editor.fontSize\": 18"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn user_update_creates_settings_file_when_missing() {
        let root = std::env::temp_dir().join(format!(
            "sidex-settings-empty-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("settings.json");
        let store = SettingsStore::new();
        store.set_user_path(&path);
        store
            .update(
                "vac.customModels",
                serde_json::json!([{"modelId":"custom"}]),
                "user",
            )
            .unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["vac.customModels"][0]["modelId"], "custom");
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn failed_write_and_invalid_json_leave_memory_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"editor.fontSize":12}"#).unwrap();
        let store = SettingsStore::new();
        store.load_user(&path).unwrap();
        std::fs::write(&path, "{ invalid").unwrap();
        assert!(store.update("editor.fontSize", serde_json::json!(99), "user").is_err());
        assert_eq!(store.inner.read().unwrap().get_raw("editor.fontSize"), Some(&serde_json::json!(12)));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ invalid");
        let blocker = dir.path().join("not-a-directory");
        std::fs::write(&blocker, "keep").unwrap();
        store.set_user_path(&blocker.join("settings.json"));
        assert!(store.update("editor.fontSize", serde_json::json!(99), "user").is_err());
        assert_eq!(store.inner.read().unwrap().get_raw("editor.fontSize"), Some(&serde_json::json!(12)));
        assert_eq!(std::fs::read_to_string(blocker).unwrap(), "keep");
    }

    #[test]
    fn refresh_deleted_file_clears_old_overrides() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"vac.customModels":["old"]}"#).unwrap();
        let store = SettingsStore::new();
        store.load_user(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        store.refresh_user_from_disk().unwrap();
        assert!(store.inner.read().unwrap().user_layer().as_object().unwrap().is_empty());
    }

    #[test]
    fn concurrent_user_updates_do_not_drop_extension_keys() {
        let dir = tempfile::tempdir().unwrap();
        let store = std::sync::Arc::new(SettingsStore::new());
        store.set_user_path(&dir.path().join("settings.json"));
        let threads: Vec<_> = (0..12).map(|i| {
            let store = store.clone();
            std::thread::spawn(move || store.update(&format!("extension.key{i}"), serde_json::json!(i), "user").unwrap())
        }).collect();
        for thread in threads { thread.join().unwrap(); }
        store.refresh_user_from_disk().unwrap();
        let merged = store.inner.read().unwrap().merged();
        for i in 0..12 { assert_eq!(merged[format!("extension.key{i}")], serde_json::json!(i)); }
    }

}
