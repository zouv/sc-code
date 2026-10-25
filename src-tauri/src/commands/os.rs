use serde::Serialize;
use std::env;

#[derive(Debug, Serialize)]
pub struct OsInfo {
    pub platform: String,
    pub arch: String,
    pub hostname: String,
    pub homedir: String,
    pub tmpdir: String,
}

#[tauri::command]
pub fn get_os_info() -> OsInfo {
    OsInfo {
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        hostname: hostname::get().map_or_else(
            |_| "unknown".to_string(),
            |h| h.to_string_lossy().to_string(),
        ),
        homedir: dirs::home_dir().map_or_else(
            || "unknown".to_string(),
            |p| p.to_string_lossy().to_string(),
        ),
        tmpdir: env::temp_dir().to_string_lossy().to_string(),
    }
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn get_env(key: String) -> Option<String> {
    env::var(&key).ok()
}

const SENSITIVE_ENV_PATTERNS: &[&str] = &[
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "API_KEY",
    "APIKEY",
    "AUTH",
    "AWS_",
    "AZURE_",
    "GCP_",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "DOCKER_PASSWORD",
    "SSH_",
    "GPG_",
];

#[tauri::command]
pub fn get_all_env() -> std::collections::HashMap<String, String> {
    env::vars()
        .filter(|(key, _)| {
            let upper = key.to_uppercase();
            !SENSITIVE_ENV_PATTERNS.iter().any(|p| upper.contains(p))
        })
        .collect()
}

#[tauri::command]
pub fn get_shell() -> String {
    env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "windows") {
            super::terminal::resolve_windows_shell()
        } else {
            "/bin/sh".to_string()
        }
    })
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn get_user_data_dir() -> Result<String, String> {
    let user_dir = crate::app_dirs::app_data_dir();
    std::fs::create_dir_all(&user_dir)
        .map_err(|e| format!("failed to create ScCode app data dir: {e}"))?;
    Ok(user_dir.to_string_lossy().to_string())
}

/// Parses the build from `ver` output, e.g. `Microsoft Windows [Version 10.0.19045.6456]`
/// (the word "Version" is localized, the numbers are not).
fn parse_windows_build(ver_output: &str) -> Option<u32> {
    let start = ver_output.find("10.0.").or_else(|| ver_output.find("6."))?;
    ver_output[start..]
        .split(|c: char| !c.is_ascii_digit() && c != '.')
        .next()?
        .split('.')
        .nth(2)?
        .parse()
        .ok()
}

/// Windows build number for xterm's ConPTY handling (`IProcessReadyWindowsPty`); cached.
#[tauri::command]
pub fn get_windows_build_number() -> Option<u32> {
    static BUILD: std::sync::OnceLock<Option<u32>> = std::sync::OnceLock::new();
    *BUILD.get_or_init(|| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let output = std::process::Command::new("cmd")
                .args(["/c", "ver"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .ok()?;
            parse_windows_build(&String::from_utf8_lossy(&output.stdout))
        }
        #[cfg(not(windows))]
        {
            None
        }
    })
}

#[cfg(test)]
mod windows_build_tests {
    use super::parse_windows_build;

    #[test]
    fn parses_localized_ver_output() {
        assert_eq!(parse_windows_build("\r\nMicrosoft Windows [Version 10.0.19045.6456]\r\n"), Some(19045));
        assert_eq!(parse_windows_build("Microsoft Windows [版本 10.0.22631.4317]"), Some(22631));
        assert_eq!(parse_windows_build("garbage"), None);
    }
}
