use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::storage::StorageDb;
use crate::taskbar::OpenTarget;

static WORKSPACE_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Windows whose close request was approved by the workbench (unsaved-changes prompt done).
fn approved_closes() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static APPROVED: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    APPROVED.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

pub fn approve_close(label: &str) {
    if let Ok(mut approved) = approved_closes().lock() {
        approved.insert(label.to_string());
    }
}

/// Consumes one approval; the first `close()` after it goes through, later ones prompt again.
pub fn take_close_approval(label: &str) -> bool {
    approved_closes()
        .lock()
        .is_ok_and(|mut approved| approved.remove(label))
}

/// WebView2 user data folder for an isolated `SC_CODE_HOME` profile (WebView2 itself
/// adds the `EBWebView` child). Window configs cannot carry it: Tauri drops
/// `dataDirectory` when converting a window config to webview attributes, so every
/// builder must set it explicitly. The default profile keeps the WebView2 default
/// location so existing users' browser state is not orphaned.
pub fn isolated_webview_data_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("SC_CODE_HOME").map(|_| crate::app_dirs::app_data_dir())
}

/// Builds a workbench window from a window config, applying the profile's WebView data folder.
pub fn build_workbench_window<M: Manager<tauri::Wry>>(
    manager: &M,
    config: &tauri::utils::config::WindowConfig,
) -> Result<tauri::WebviewWindow, String> {
    let mut builder = WebviewWindowBuilder::from_config(manager, config)
        .map_err(|e| format!("failed to create window '{}': {e}", config.label))?;
    if let Some(dir) = isolated_webview_data_dir() {
        builder = builder.data_directory(dir);
    }
    builder
        .build()
        .map_err(|e| format!("failed to build window '{}': {e}", config.label))
}

/// Open a new workbench window for a jump-list target. Reusing the main window
/// would discard the user's current workspace, so recent entries always get
/// their own window.
pub fn open_target_window(app: &AppHandle, target: &OpenTarget) -> Result<(), String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "main window config is missing".to_string())?;

    let id = WORKSPACE_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    config.label = format!("workspace-{id}");
    config.url = WebviewUrl::App(target.app_url().into());
    config.visible = true;
    config.focus = true;
    config.create = true;

    build_workbench_window(app, &config)?;

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f64,
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn create_window(
    app: AppHandle,
    label: String,
    title: String,
    url: Option<String>,
) -> Result<(), String> {
    let webview_url = match url {
        Some(u) => WebviewUrl::External(u.parse().map_err(|e| format!("Invalid URL: {e}"))?),
        None => WebviewUrl::default(),
    };

    let builder = WebviewWindowBuilder::new(&app, &label, webview_url)
        .title(&title)
        .inner_size(1200.0, 800.0);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false).shadow(true);

    builder
        .build()
        .map_err(|e| format!("Failed to create window '{label}': {e}"))?;

    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn close_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window '{label}' not found"))?;

    // The workbench already ran the unsaved-changes prompt for this close.
    approve_close(&label);
    window
        .close()
        .map_err(|e| format!("Failed to close window '{label}': {e}"))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn set_window_title(app: AppHandle, label: String, title: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window '{label}' not found"))?;

    window
        .set_title(&title)
        .map_err(|e| format!("Failed to set title for '{label}': {e}"))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitors: {e}"))?;

    Ok(monitors
        .into_iter()
        .map(|m| {
            let size = m.size();
            let pos = m.position();
            MonitorInfo {
                name: m.name().cloned(),
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
                scale_factor: m.scale_factor(),
            }
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

const WINDOW_STATE_KEY: &str = "sc-code.windowState";

#[allow(clippy::cast_possible_wrap)]
pub fn restore_and_show(app: &tauri::App, db: &StorageDb) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Ok(Some(json)) = db.get(WINDOW_STATE_KEY) {
        if let Ok(state) = serde_json::from_str::<WindowState>(&json) {
            // Only restores position if it lands on an available monitor.
            let on_screen = app.available_monitors().ok().is_some_and(|monitors| {
                monitors.iter().any(|m| {
                    let pos = m.position();
                    let size = m.size();
                    let right = pos.x + size.width as i32;
                    let bottom = pos.y + size.height as i32;
                    // Require at least 100x50px of the window to be visible
                    state.x + 100 < right
                        && state.x + state.width as i32 > pos.x + 100
                        && state.y + 50 < bottom
                        && state.y > pos.y - 50
                })
            });

            if on_screen {
                let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
                let _ = window.set_position(tauri::PhysicalPosition::new(state.x, state.y));
                if state.maximized {
                    let _ = window.maximize();
                }
            }
        }
    }

    let _ = window.show();
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
pub fn save_window_state(
    app: AppHandle,
    label: String,
    db: tauri::State<'_, Arc<StorageDb>>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window '{label}' not found"))?;

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let maximized = window.is_maximized().unwrap_or(false);

    let state = WindowState {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized,
    };

    let json = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    db.set(WINDOW_STATE_KEY, &json)?;
    Ok(())
}
