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

const PROFILE_DIR_NAME: &str = "ScCode";

/// Returns the primary application data directory for ScCode.
///
/// This is where settings.json, databases, and other user data live.
/// The path follows platform conventions and respects XDG on Linux.
pub fn app_data_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("SC_CODE_HOME") {
        return PathBuf::from(home);
    }
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

/// Returns the canonical application data directory, creating it if needed.
pub fn resolve_app_data_dir() -> PathBuf {
    let dir = app_data_dir();
    if let Err(error) = std::fs::create_dir_all(&dir) {
        log::error!(
            "Cannot create ScCode data directory {}: {error}",
            dir.display()
        );
    }
    dir
}
