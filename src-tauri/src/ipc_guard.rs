//! Restricts app commands to the workbench's own origin.
//!
//! Tauri app commands without an ACL manifest are callable from any frame that
//! received the IPC script, and on Windows wry injects it into every frame
//! (extension webviews included). The custom-protocol IPC path carries the
//! browser-set `Origin` header of the calling frame, which page script cannot
//! forge, so only the workbench origins are let through.

use tauri::http::HeaderMap;

const WORKBENCH_ORIGINS: &[&str] = &["https://tauri.localhost", "http://tauri.localhost", "tauri://localhost"];

fn normalize(origin: &str) -> &str {
    origin.trim_end_matches('/')
}

/// `dev_origin` is the dev server origin and must only be passed for `tauri dev` builds.
pub fn is_trusted_origin(headers: &HeaderMap, dev_origin: Option<&str>) -> bool {
    let Some(origin) = headers.get("origin") else {
        // post-message fallback: only reachable through `window.chrome.webview`,
        // which WebView2 exposes to the top-level document, not to sub-frames.
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let origin = normalize(origin);
    WORKBENCH_ORIGINS.contains(&origin) || dev_origin.is_some_and(|dev| normalize(dev) == origin)
}

/// Origin of the dev server when running under `tauri dev`; `None` for packaged builds.
pub fn dev_origin(config: &tauri::Config) -> Option<String> {
    if !tauri::is_dev() {
        return None;
    }
    config.build.dev_url.as_ref().map(|url| url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::HeaderValue;

    fn with_origin(origin: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("Origin", HeaderValue::from_str(origin).unwrap());
        headers
    }

    #[test]
    fn accepts_workbench_origins() {
        assert!(is_trusted_origin(&with_origin("https://tauri.localhost"), None));
        assert!(is_trusted_origin(&with_origin("http://tauri.localhost/"), None));
        assert!(is_trusted_origin(&HeaderMap::new(), None));
        assert!(is_trusted_origin(&with_origin("http://localhost:1420"), Some("http://localhost:1420")));
    }

    #[test]
    fn rejects_webview_and_foreign_origins() {
        for origin in [
            "http://127.0.0.1:51234",
            "https://sc-webview.localhost",
            "https://asset.localhost",
            "https://tauri.localhost.evil.example",
            "https://example.com",
            "null",
        ] {
            assert!(!is_trusted_origin(&with_origin(origin), None), "{origin}");
        }
        assert!(!is_trusted_origin(&with_origin("http://localhost:1420"), None));
    }
}
