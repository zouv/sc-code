//! Real VSCode Node extension host supervisor.
//!
//! Spawns the bundled `extensionHost.cjs` (built by
//! `scripts/build-ext-host.cjs`) and exposes its loopback WebSocket endpoint to
//! the workbench. The legacy `host.cjs` shim continues to live in
//! `extension_host.rs`; this module is only used when the workbench enables the
//! experimental real-host path.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::extension_platform::resolve_node_runtime;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealExtensionHostEndpoint {
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

pub struct RealExtensionHost {
    child: Mutex<Option<Child>>,
    endpoint: Mutex<Option<RealExtensionHostEndpoint>>,
    /// Serializes concurrent `real_ext_host_start` calls. The workbench can
    /// request the host from more than one initialization path during a
    /// reload; without this they race and spawn duplicate processes.
    start_lock: Mutex<()>,
}

impl RealExtensionHost {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            endpoint: Mutex::new(None),
            start_lock: Mutex::new(()),
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        if let Ok(mut endpoint) = self.endpoint.lock() {
            *endpoint = None;
        }
    }
}

fn find_bundle(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("SC_CODE_EXT_HOST_BUNDLE") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Ok(path) = app.path().resolve(
        "extension-host/extensionHost.cjs",
        tauri::path::BaseDirectory::Resource,
    ) {
        if path.is_file() {
            return Some(path);
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest_dir.join("../.runtime/desktop/extension-host/extensionHost.cjs");
    dev.is_file().then_some(dev)
}

fn parse_endpoint(line: &str) -> Result<RealExtensionHostEndpoint, String> {
    let value: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|e| format!("invalid extension host handshake: {e}"))?;
    let port = value
        .get("port")
        .and_then(serde_json::Value::as_u64)
        .ok_or("extension host did not report a port")? as u16;
    let pid = value
        .get("pid")
        .and_then(serde_json::Value::as_u64)
        .ok_or("extension host did not report a pid")? as u32;
    Ok(RealExtensionHostEndpoint {
        port,
        token: String::new(),
        pid,
    })
}

/// Read the first stdout line on a worker thread so a hung child cannot block
/// the command (and the start lock) forever.
fn read_handshake(stdout: ChildStdout, sender: std::sync::mpsc::Sender<Result<String, String>>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let result = reader
        .read_line(&mut line)
        .map(|_| line)
        .map_err(|e| format!("read extension host handshake: {e}"));
    let _ = sender.send(result);
    // Keep draining stdout for the host's lifetime: its `console.log` output would
    // otherwise fill the pipe (64 KiB) and block the host.
    let mut rest = String::new();
    loop {
        rest.clear();
        match reader.read_line(&mut rest) {
            Ok(0) | Err(_) => break,
            Ok(_) => log::info!("[ext-host stdout] {}", rest.trim_end()),
        }
    }
}

fn fail_with_stderr(child: &mut Child, error: String) -> String {
    let _ = child.kill();
    let status = child.wait().ok();
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }
    if !stderr.is_empty() {
        log::error!("[ext-host] handshake failed: {error} (status {status:?}) stderr: {stderr}");
        format!("{error}; stderr: {stderr}")
    } else {
        log::error!("[ext-host] handshake failed: {error} (status {status:?})");
        error
    }
}

/// Windows canonicalization returns `\\?\D:\...` verbatim paths. Node cannot
/// treat such a path as its script argument (it resolves to `D:` and fails
/// with EISDIR), so strip the prefix before spawning.
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

/// Spawning Node and waiting (up to 20 s) for its endpoint line must not run on the
/// main thread, which drives the window event loop.
#[tauri::command]
pub async fn real_ext_host_start(
    app: AppHandle,
    host: tauri::State<'_, std::sync::Arc<RealExtensionHost>>,
) -> Result<RealExtensionHostEndpoint, String> {
    let host = std::sync::Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || start_blocking(&app, &host))
        .await
        .map_err(|e| format!("extension host start task failed: {e}"))?
}

fn start_blocking(
    app: &AppHandle,
    host: &std::sync::Arc<RealExtensionHost>,
) -> Result<RealExtensionHostEndpoint, String> {
    let _start_guard = host.start_lock.lock().map_err(|e| e.to_string())?;

    {
        let mut child = host.child.lock().map_err(|e| e.to_string())?;
        let endpoint = host.endpoint.lock().map_err(|e| e.to_string())?.clone();
        if let Some(existing) = endpoint {
            if let Some(process) = child.as_mut() {
                if matches!(process.try_wait(), Ok(None)) {
                    return Ok(existing);
                }
            }
            *child = None;
        }
    }

    let node = resolve_node_runtime(&app)?;
    let node_path = strip_verbatim(PathBuf::from(&node.path));
    let bundle = strip_verbatim(
        find_bundle(&app)
            .ok_or("Real extension host bundle not found; run `npm run ext-host:build` first.")?,
    );
    log::info!(
        "[ext-host] spawning {} {}",
        node_path.display(),
        bundle.display()
    );
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );

    let mut command = Command::new(&node_path);
    command
        .arg(&bundle)
        .env("SC_CODE_EXT_HOST_PORT", "0")
        .env("SC_CODE_EXT_HOST_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|e| format!("spawn extension host: {e}"))?;
    let Some(stdout) = child.stdout.take() else {
        return Err(fail_with_stderr(
            &mut child,
            "extension host stdout unavailable".into(),
        ));
    };
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || read_handshake(stdout, sender));
    let line = match receiver.recv_timeout(Duration::from_secs(20)) {
        Ok(Ok(line)) => line,
        Ok(Err(error)) => return Err(fail_with_stderr(&mut child, error)),
        Err(_) => {
            return Err(fail_with_stderr(
                &mut child,
                "extension host did not report a port within 20s".into(),
            ));
        }
    };
    let endpoint = match parse_endpoint(&line) {
        Ok(mut endpoint) => {
            endpoint.token = token;
            endpoint
        }
        Err(error) => return Err(fail_with_stderr(&mut child, error)),
    };
    if endpoint.port == 0 {
        return Err(fail_with_stderr(
            &mut child,
            "extension host reported port 0".into(),
        ));
    }

    // The host keeps writing diagnostics to stderr for its whole lifetime. An unread
    // pipe fills up (64 KiB) and then blocks the host process indefinitely.
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                log::info!("[ext-host stderr] {line}");
            }
        });
    }

    *host.child.lock().map_err(|e| e.to_string())? = Some(child);
    *host.endpoint.lock().map_err(|e| e.to_string())? = Some(endpoint.clone());
    log::info!(
        "[ext-host] real extension host started on 127.0.0.1:{} (pid {})",
        endpoint.port,
        endpoint.pid
    );
    Ok(endpoint)
}

#[tauri::command(async)]
pub fn real_ext_host_stop(host: tauri::State<'_, std::sync::Arc<RealExtensionHost>>) {
    host.shutdown();
}
