//! Centralized application directory resolution for ScCode.
//!
//! On Linux, follows the XDG Base Directory Specification:
//!   - Config/user data: `$XDG_CONFIG_HOME/ScCode` (default `~/.config/ScCode`)
//!
//! On macOS:
//!   - `~/Library/Application Support/ScCode`
//!
//! On Windows:
//!   - `%APPDATA%/ScCode`
//!
//! This matches the convention used by VSCode (`~/.config/Code`),
//! Cursor (`~/.config/Cursor`), and VSCodium (`~/.config/VSCodium`).

use std::path::PathBuf;

// Canonical profile name; Sc-Code remains a copy-only migration source.
const PROFILE_DIR_NAME: &str = "ScCode";

/// Returns the primary application data directory for ScCode.
///
/// This is where settings.json, databases, and other user data live.
/// The path follows platform conventions and respects XDG on Linux.
pub fn app_data_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("SC_CODE_HOME") { return PathBuf::from(home); }
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".config")
            });
        base.join(PROFILE_DIR_NAME)
    }

    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join(PROFILE_DIR_NAME)
    }

    #[cfg(target_os = "windows")]
    {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(PROFILE_DIR_NAME)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(PROFILE_DIR_NAME)
    }
}

/// Legacy application data directory path (used before XDG migration).
///
/// On Linux this was `~/.local/share/com.siden.sidex`.
/// On macOS this was `~/Library/Application Support/com.siden.sidex`.
/// On Windows this was `%LOCALAPPDATA%/com.siden.sidex`.
fn legacy_app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".local")
                    .join("share")
            });
        Some(base.join("com.siden.sidex"))
    }

    #[cfg(target_os = "macos")]
    {
        Some(
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Library")
                .join("Application Support")
                .join("com.siden.sidex"),
        )
    }

    #[cfg(target_os = "windows")]
    {
        dirs::data_local_dir().map(|d| d.join("com.siden.sidex"))
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

/// Explicit first-import consent: non-SQLite stores (Bolt/LevelDB/WebView) need quiescent sources.
/// Called before creating the event loop; never block the main UI thread on a dialog.
pub fn confirm_first_migration() -> Result<bool, String> {
    let destination = app_data_dir();
    let marker = destination.join(".sc-code-migration-v1.json");
    sc_code_runtime::migration::reject_symlink_ancestors(&marker).map_err(|e| e.to_string())?;
    let completed = match std::fs::read(&marker) {
        Ok(bytes) => serde_json::from_slice::<sc_code_runtime::migration::MigrationReport>(&bytes)
            .map_err(|e| format!("Invalid migration journal (preserved): {e}"))?.completed_sources,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.to_string()),
    };
    let pending: Vec<_> = migration_sources().into_iter().filter(|p| p.is_dir())
        .filter(|p| p.canonicalize().map(|p| !completed.contains(&p)).unwrap_or(true)).collect();
    if pending.is_empty() { return Ok(true); }
    let sources = pending.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n");
    Ok(rfd::MessageDialog::new().set_title("ScCode — 首次数据导入")
        .set_description(format!("这不是启动错误。ScCode 检测到旧应用数据，准备首次导入。\n\n请先关闭旧 Sc-Code、SideX/custom-sidex 及其 Agent 进程，避免复制正在写入的数据库。SQLite 使用一致快照，其他数据库需要旧应用完全停止。Sc-Code 是本应用旧版本的数据目录。\n\n来源：\n{sources}\n\n目标：\n{}\n\n只复制缺失数据，不覆盖目标已有文件，也不删除旧数据。\n确定：开始导入并启动。取消：退出本次启动，不修改数据，下次仍会提示。", destination.display()))
        .set_buttons(rfd::MessageButtons::OkCancel).show() == rfd::MessageDialogResult::Ok)
}

/// Copy legacy data without moving/deleting sources or overwriting ScCode data.
/// Close the old app before first launch so database files are not live.
pub fn resolve_and_migrate() -> PathBuf {
    let new_dir = app_data_dir();
    match sc_code_runtime::migration::migrate_once(&migration_sources(), &new_dir) {
        Ok(report) => for failure in report.failures { log::warn!("Incomplete migration: {failure}"); },
        Err(error) => log::warn!("Migration journal failed; refusing repeated import: {error}"),
    }
    #[cfg(target_os = "linux")]
    if std::env::var_os("SC_CODE_HOME").is_none() && std::env::var_os("SC_CODE_MIGRATION_SOURCES").is_none() {
    if let Some(base) = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| dirs::home_dir().map(|p| p.join(".local/share"))) {
        if let Err(error) = sc_code_runtime::migration::migrate_once(&[base.join("Sc-Code"), base.join("SideX")], &base.join("ScCode")) {
            log::warn!("Linux extension data migration failed: {error}");
        }
    }
    }
    if let Err(error) = std::fs::create_dir_all(&new_dir) {
        log::error!("Cannot create ScCode data directory {}: {error}", new_dir.display());
    }
    new_dir
}

fn migration_sources() -> Vec<PathBuf> {
    if let Some(sources) = std::env::var_os("SC_CODE_MIGRATION_SOURCES") {
        return deduplicate_migration_sources(std::env::split_paths(&sources).collect());
    }
    // Isolated/custom homes do not silently import the real user profile.
    if std::env::var_os("SC_CODE_HOME").is_some() { return Vec::new(); }
    let mut sources = Vec::new();
    if let Some(parent) = app_data_dir().parent() {
        sources.push(parent.join("Sc-Code")); // Most recent profile takes precedence over original SideX.
        sources.push(parent.join("SideX"));
        sources.push(parent.join("dev.sidex.app"));
    }
    if let Some(base) = dirs::data_dir() {
        sources.push(base.join("dev.sidex.app"));
        sources.push(base.join("com.siden.sidex"));
    }
    if let Some(base) = dirs::data_local_dir() { sources.push(base.join("dev.sidex.app")); }
    if let Some(legacy) = legacy_app_data_dir() { sources.push(legacy); }
    if let Some(home) = dirs::home_dir() { sources.push(home.join(".sidex")); }
    deduplicate_migration_sources(sources)
}

/// Canonical identity avoids duplicated Windows Roaming sources and path aliases.
/// Keep the first display path and precedence; never move or delete a source.
fn deduplicate_migration_sources(sources: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    sources.into_iter().filter(|source| {
        seen.insert(source.canonicalize().unwrap_or_else(|_| source.clone()))
    }).collect()
}

fn copy_dir_recursive_skipping(
    src: &std::path::Path, dst: &std::path::Path, skip_file: Option<&std::path::Path>,
) -> std::io::Result<()> {
    sc_code_runtime::migration::copy_missing(src, dst, skip_file).map(|_| ())
}

/// Copy user-data files into the canonical app-data root without replacing
/// anything that already exists there. Keep the source tree as a recovery copy.
// [CUSTOM-BEGIN] CUSTOM-20261013-010 - migrate legacy user data without overwrites
pub(crate) fn migrate_user_data_into_skipping(
    src: &std::path::Path,
    dst: &std::path::Path,
    skip_file: Option<&std::path::Path>,
) {
    if !src.is_dir() || src == dst {
        return;
    }

    if let Err(e) = copy_dir_recursive_skipping(src, dst, skip_file) {
        log::warn!(
            "Could not fully migrate user data from {} to {}: {e}",
            src.display(),
            dst.display()
        );
    }
}
// [CUSTOM-END] CUSTOM-20261013-010

/// Migrate a settings file if the canonical target does not exist. Invalid
/// JSONC is left untouched so it can be recovered manually.
// [CUSTOM-BEGIN] CUSTOM-20261013-010 - migrate legacy settings safely without overwrites
pub(crate) fn migrate_settings_file(src: &std::path::Path, dst: &std::path::Path) {
    if dst.exists() || !src.is_file() {
        return;
    }

    let contents = match std::fs::read_to_string(src) {
        Ok(contents) => contents,
        Err(e) => {
            log::warn!("Could not read legacy settings {}: {e}", src.display());
            return;
        }
    };
    if let Err(e) = sidex_settings::parse_jsonc(&contents) {
        log::warn!(
            "Not migrating invalid legacy settings {}: {e}",
            src.display()
        );
        return;
    }
    match sc_code_runtime::migration::copy_file_missing(src, dst) {
        Ok(true) => log::info!("Migrated settings from {} to {}", src.display(), dst.display()),
        Ok(false) => {},
        Err(e) => log::warn!("Could not migrate settings {} to {}: {e}", src.display(), dst.display()),
    }
}
// [CUSTOM-END] CUSTOM-20261013-010
#[cfg(test)]
mod tests {
    use super::{deduplicate_migration_sources, migrate_settings_file, migrate_user_data_into_skipping};
    use std::path::Path;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let unique = format!(
            "sidex-user-data-migration-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
    }

    #[test]
    fn migration_sources_keep_first_path_and_deduplicate_canonical_aliases() {
        let root = temp_dir("deduplicate");
        let source = root.join("profile");
        std::fs::create_dir_all(&source).unwrap();
        let alias = source.join("..").join("profile");
        let other = root.join("other");
        let result = deduplicate_migration_sources(vec![source.clone(), source.clone(), alias, other.clone(), other.clone()]);
        assert_eq!(result, vec![source, other]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn copies_missing_user_data_without_replacing_existing_files() {
        let source = temp_dir("source");
        let target = temp_dir("target");
        std::fs::create_dir_all(source.join("User")).unwrap();
        std::fs::create_dir_all(target.join("User")).unwrap();
        std::fs::write(
            source.join("User/settings.json"),
            r#"{"vac.customModels":[]}"#,
        )
        .unwrap();
        std::fs::write(source.join("User/keybindings.json"), "{}").unwrap();
        std::fs::write(target.join("User/settings.json"), "target settings").unwrap();

        migrate_user_data_into_skipping(&source, &target, None);

        assert_eq!(
            std::fs::read_to_string(target.join("User/settings.json")).unwrap(),
            "target settings"
        );
        assert_eq!(
            std::fs::read_to_string(target.join("User/keybindings.json")).unwrap(),
            "{}"
        );
        assert_eq!(
            std::fs::read_to_string(source.join("User/settings.json")).unwrap(),
            r#"{"vac.customModels":[]}"#
        );
        let _ = std::fs::remove_dir_all(source);
        let _ = std::fs::remove_dir_all(target);
    }

    #[test]
    fn migrates_valid_jsonc_without_rewriting_and_keeps_source() {
        let root = temp_dir("settings");
        let source = root.join("legacy/settings.json");
        let target = root.join("new/User/settings.json");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        let contents = r#"{
  // custom models
  "vac.customModels": [],
}
"#;
        std::fs::write(&source, contents).unwrap();

        migrate_settings_file(&source, &target);

        assert_eq!(std::fs::read_to_string(&target).unwrap(), contents);
        assert_eq!(std::fs::read_to_string(&source).unwrap(), contents);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_overwrite_target_or_migrate_invalid_jsonc() {
        let root = temp_dir("settings-conflict");
        let source = root.join("legacy/settings.json");
        let target = root.join("new/User/settings.json");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&source, "not json").unwrap();
        std::fs::write(&target, "target settings").unwrap();

        migrate_settings_file(&source, &target);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "target settings");

        std::fs::remove_file(&target).unwrap();
        migrate_settings_file(&source, &target);
        assert!(!target.exists());
        assert_eq!(std::fs::read_to_string(&source).unwrap(), "not json");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ignores_missing_source() {
        let target = temp_dir("missing-target");
        migrate_user_data_into_skipping(Path::new("missing-user-data-source"), &target, None);
        assert!(!target.exists());
    }
}
