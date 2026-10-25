use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

pub struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    flow: Arc<FlowControl>,
}

/// Same thresholds as VS Code's pty host (`FlowControlConstants`), in UTF-16 chars.
const HIGH_WATERMARK_CHARS: usize = 100_000;
const LOW_WATERMARK_CHARS: usize = 5_000;
/// A consumer that stops acknowledging (reloaded webview, lost acks) must not wedge the shell.
const MAX_PAUSE: Duration = Duration::from_secs(5);
/// How often a terminal's shell is checked for exit (see `terminal_spawn`).
const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Back-pressure between the PTY reader and xterm: the reader pauses while more than
/// `HIGH_WATERMARK_CHARS` are unacknowledged and resumes below `LOW_WATERMARK_CHARS`.
#[derive(Default)]
pub struct FlowControl {
    unacked: Mutex<usize>,
    resume: Condvar,
    closed: AtomicBool,
}

impl FlowControl {
    fn sent(&self, chars: usize) {
        if let Ok(mut unacked) = self.unacked.lock() {
            *unacked += chars;
        }
    }

    fn ack(&self, chars: usize) {
        if let Ok(mut unacked) = self.unacked.lock() {
            *unacked = unacked.saturating_sub(chars);
            if *unacked <= LOW_WATERMARK_CHARS {
                self.resume.notify_all();
            }
        }
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
        self.resume.notify_all();
    }

    /// Blocks the reader while the consumer is behind; gives up after `max_pause`.
    fn wait_for_capacity(&self, max_pause: Duration) {
        let Ok(mut unacked) = self.unacked.lock() else {
            return;
        };
        let deadline = Instant::now() + max_pause;
        while *unacked > HIGH_WATERMARK_CHARS && !self.closed.load(Ordering::Relaxed) {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                *unacked = 0;
                return;
            };
            match self.resume.wait_timeout(unacked, remaining) {
                Ok((guard, _)) => unacked = guard,
                Err(_) => return,
            }
        }
    }
}

/// Incremental UTF-8 decoding for PTY chunks: a multi-byte character split across
/// two reads is held back instead of being turned into U+FFFD on both sides.
#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    fn incomplete_tail_len(bytes: &[u8]) -> usize {
        for back in 1..=bytes.len().min(3) {
            let byte = bytes[bytes.len() - back];
            if byte & 0xC0 == 0x80 {
                continue; // continuation byte, keep looking for the lead byte
            }
            let needed = match byte {
                0xF0..=0xFF => 4,
                0xE0..=0xEF => 3,
                0xC0..=0xDF => 2,
                _ => 1,
            };
            return if needed > back { back } else { 0 };
        }
        0
    }

    fn decode(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);
        let keep = Self::incomplete_tail_len(&self.pending);
        let ready = self.pending.len() - keep;
        let text = String::from_utf8_lossy(&self.pending[..ready]).into_owned();
        self.pending.drain(..ready);
        text
    }

    fn finish(&mut self) -> String {
        let text = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        text
    }
}

/// Per-terminal output stream delivered only to the webview that spawned the terminal;
/// `exit` is always the last message.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { data: String },
    Exit {
        #[serde(rename = "exitCode")]
        exit_code: i32,
    },
}

pub struct TerminalStore {
    terminals: Mutex<HashMap<u32, PtyHandle>>,
    next_id: Mutex<u32>,
}

impl TerminalStore {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }
}

pub(crate) fn resolve_windows_shell() -> String {
    for candidate in ["pwsh.exe", "powershell.exe"] {
        if let Ok(path) = which::which(candidate) {
            return path.to_string_lossy().to_string();
        }
    }

    std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
}

#[cfg(target_os = "windows")]
fn is_git_bash_path(path: &std::path::Path) -> bool {
    let normalized = path.to_string_lossy().replace('/', "\\").to_lowercase();
    normalized.ends_with("\\git\\bin\\bash.exe")
        || normalized.ends_with("\\git\\usr\\bin\\bash.exe")
}

#[cfg(target_os = "windows")]
fn resolve_git_bash() -> Option<String> {
    let mut candidates = Vec::new();

    for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(root) = std::env::var_os(key) {
            let root = std::path::PathBuf::from(root);
            candidates.push(root.join("Git").join("bin").join("bash.exe"));
            candidates.push(root.join("Git").join("usr").join("bin").join("bash.exe"));
            candidates.push(
                root.join("Programs")
                    .join("Git")
                    .join("bin")
                    .join("bash.exe"),
            );
            candidates.push(
                root.join("Programs")
                    .join("Git")
                    .join("usr")
                    .join("bin")
                    .join("bash.exe"),
            );
        }
    }

    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join("bash.exe"));
        }
    }

    candidates
        .into_iter()
        .find(|path| path.exists() && is_git_bash_path(path))
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command(async)]
#[allow(
    clippy::too_many_lines,
    clippy::needless_pass_by_value,
    clippy::too_many_arguments
)]
pub fn terminal_spawn(
    app: AppHandle,
    state: State<'_, Arc<TerminalStore>>,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
    on_event: Channel<TerminalEvent>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pty_cols = cols.unwrap_or(80);
    let pty_rows = rows.unwrap_or(24);

    let pair = pty_system
        .openpty(PtySize {
            rows: pty_rows,
            cols: pty_cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    #[allow(unused_mut)]
    let mut shell_path = shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            resolve_windows_shell()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        }
    });

    #[cfg(target_os = "windows")]
    if std::path::Path::new(&shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("bash.exe"))
        && !is_git_bash_path(std::path::Path::new(&shell_path))
    {
        if let Some(git_bash) = resolve_git_bash() {
            shell_path = git_bash;
        }
    }

    if !cfg!(target_os = "windows") {
        let path = std::path::Path::new(&shell_path);
        if !path.exists() {
            let fallbacks = ["/bin/zsh", "/bin/bash", "/bin/sh"];
            for fb in &fallbacks {
                if std::path::Path::new(fb).exists() {
                    return terminal_spawn(
                        app,
                        state,
                        Some(fb.to_string()),
                        args,
                        cwd,
                        env,
                        cols,
                        rows,
                        on_event,
                    );
                }
            }
            return Err(format!(
                "Shell '{shell_path}' not found, and no fallback shell available"
            ));
        }
    }

    let mut cmd = CommandBuilder::new(&shell_path);

    if let Some(ref shell_args) = args {
        for arg in shell_args {
            cmd.arg(arg);
        }
    } else {
        let shell_basename = std::path::Path::new(&shell_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        match shell_basename {
            "zsh" | "bash" | "sh" | "fish" => {
                cmd.arg("-l");
            }
            _ => {}
        }
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "ScCode");

    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
    }
    if cfg!(target_os = "windows") {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            cmd.env("USERPROFILE", &profile);
            if std::env::var("HOME").is_err() {
                cmd.env("HOME", &profile);
            }
        }
        for key in &[
            "USERNAME",
            "APPDATA",
            "LOCALAPPDATA",
            "HOMEDRIVE",
            "HOMEPATH",
            "COMSPEC",
            "SystemRoot",
        ] {
            if let Ok(val) = std::env::var(key) {
                cmd.env(key, &val);
            }
        }
    } else if let Ok(user) = std::env::var("USER") {
        cmd.env("USER", &user);
    }
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", &path);
    }
    if let Ok(lang) = std::env::var("LANG") {
        cmd.env("LANG", &lang);
    } else if !cfg!(target_os = "windows") {
        cmd.env("LANG", "en_US.UTF-8");
    }

    if let Some(ref dir) = cwd {
        if !dir.is_empty() && std::path::Path::new(dir).is_dir() {
            cmd.cwd(dir);
        } else if let Some(home) = home_dir_string() {
            cmd.cwd(&home);
        }
    } else if let Some(home) = home_dir_string() {
        cmd.cwd(&home);
    }

    if let Some(env_vars) = env {
        for (k, v) in env_vars {
            cmd.env(k, v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell '{shell_path}': {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {e}"))?;

    let id = {
        let mut next = state.next_id.lock().map_err(|e| e.to_string())?;
        let id = *next;
        *next += 1;
        id
    };

    let flow = Arc::new(FlowControl::default());
    {
        let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        terminals.insert(
            id,
            PtyHandle {
                writer,
                master: pair.master,
                child,
                flow: Arc::clone(&flow),
            },
        );
    }

    let terminal_id = id;
    let state_clone = state.inner().clone();
    drop(app);

    // ConPTY keeps the output pipe open after the shell exits until the pseudoconsole is
    // closed, so EOF alone never reports `exit`. The waiter records the real exit code and
    // drops the PTY (closing ConPTY); the reader then drains what is left and sends `exit`.
    let exit_slot: Arc<Mutex<Option<i32>>> = Arc::new(Mutex::new(None));
    {
        let state = state.inner().clone();
        let exit_slot = Arc::clone(&exit_slot);
        std::thread::spawn(move || loop {
            std::thread::sleep(EXIT_POLL_INTERVAL);
            let Ok(mut terminals) = state.terminals.lock() else {
                return;
            };
            let Some(handle) = terminals.get_mut(&terminal_id) else {
                return; // killed or already reaped by the reader
            };
            if let Ok(Some(status)) = handle.child.try_wait() {
                if let Ok(mut slot) = exit_slot.lock() {
                    *slot = Some(i32::try_from(status.exit_code()).unwrap_or(-1));
                }
                let handle = terminals.remove(&terminal_id);
                drop(terminals);
                drop(handle); // closes the PTY master -> reader reaches EOF
                return;
            }
        });
    }

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut decoder = Utf8Stream::default();
        let mut consumer_gone = false;
        loop {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let text = decoder.decode(&buf[..n]);
                    if text.is_empty() {
                        continue;
                    }
                    flow.sent(text.encode_utf16().count());
                    if on_event.send(TerminalEvent::Data { data: text }).is_err() {
                        consumer_gone = true; // the spawning webview is gone
                        break;
                    }
                    flow.wait_for_capacity(MAX_PAUSE);
                }
                Ok(_) | Err(_) => break,
            }
        }
        let rest = decoder.finish();
        if !rest.is_empty() {
            let _ = on_event.send(TerminalEvent::Data { data: rest });
        }

        // Reap outside the store lock. No handle means the waiter already recorded the
        // exit code (and dropped the PTY) or the terminal was killed.
        let handle = state_clone
            .terminals
            .lock()
            .ok()
            .and_then(|mut terminals| terminals.remove(&terminal_id));
        let recorded = || exit_slot.lock().ok().and_then(|slot| *slot).unwrap_or(0);
        let exit_code = handle.map_or_else(recorded, |mut handle| {
            if consumer_gone {
                let _ = handle.child.kill();
            }
            handle
                .child
                .wait()
                .map_or(-1, |status| i32::try_from(status.exit_code()).unwrap_or(-1))
        });
        let _ = on_event.send(TerminalEvent::Exit { exit_code });
    });

    Ok(id)
}

/// xterm consumed `char_count` UTF-16 chars of output (VS Code `acknowledgeDataEvent`).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn terminal_ack(state: State<'_, Arc<TerminalStore>>, terminal_id: u32, char_count: usize) {
    if let Ok(terminals) = state.terminals.lock() {
        if let Some(handle) = terminals.get(&terminal_id) {
            handle.flow.ack(char_count);
        }
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn terminal_write(
    state: State<'_, Arc<TerminalStore>>,
    terminal_id: u32,
    data: String,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let handle = terminals
        .get_mut(&terminal_id)
        .ok_or_else(|| format!("Terminal {terminal_id} not found"))?;

    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to terminal {terminal_id}: {e}"))?;

    handle
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal {terminal_id}: {e}"))?;

    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn terminal_resize(
    state: State<'_, Arc<TerminalStore>>,
    terminal_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let handle = terminals
        .get(&terminal_id)
        .ok_or_else(|| format!("Terminal {terminal_id} not found"))?;

    handle
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal {terminal_id}: {e}"))?;

    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn terminal_kill(state: State<'_, Arc<TerminalStore>>, terminal_id: u32) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let mut handle = terminals
        .remove(&terminal_id)
        .ok_or_else(|| format!("Terminal {terminal_id} not found"))?;
    handle.flow.close();

    handle
        .child
        .kill()
        .map_err(|e| format!("Failed to kill terminal {terminal_id}: {e}"))?;

    Ok(())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn terminal_get_pid(
    state: State<'_, Arc<TerminalStore>>,
    terminal_id: u32,
) -> Result<u32, String> {
    let terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let handle = terminals
        .get(&terminal_id)
        .ok_or_else(|| format!("Terminal {terminal_id} not found"))?;

    let pid = handle
        .child
        .process_id()
        .ok_or_else(|| "Process ID not available".to_string())?;

    Ok(pid)
}

fn home_dir_string() -> Option<String> {
    if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE")
            .ok()
            .or_else(|| std::env::var("HOME").ok())
    } else {
        std::env::var("HOME").ok()
    }
}

#[tauri::command]
pub fn get_default_shell() -> String {
    if cfg!(target_os = "windows") {
        return resolve_windows_shell();
    }

    // 1. Check $SHELL (same as VS Code: shell.ts getSystemShellUnixLike)
    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.is_empty() && shell != "/bin/false" {
            return shell;
        }
    }

    // 2. Read from passwd via libc (same as VS Code: os.userInfo().shell)
    #[cfg(unix)]
    {
        #[allow(unsafe_code)]
        unsafe {
            let uid = libc::getuid();
            let pw = libc::getpwuid(uid);
            if !pw.is_null() {
                let shell_cstr = std::ffi::CStr::from_ptr((*pw).pw_shell);
                if let Ok(s) = shell_cstr.to_str() {
                    if !s.is_empty() && s != "/bin/false" {
                        return s.to_string();
                    }
                }
            }
        }
    }

    // 3. Fallback: zsh first on macOS, then bash
    for fb in &["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if std::path::Path::new(fb).exists() {
            return fb.to_string();
        }
    }
    "/bin/sh".to_string()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn check_shell_exists(path: String) -> bool {
    if cfg!(target_os = "windows") {
        return std::path::Path::new(&path).exists() || which::which(&path).is_ok();
    }

    std::path::Path::new(&path).exists()
}

#[tauri::command]
#[allow(clippy::too_many_lines)]
pub fn get_available_shells() -> Vec<ShellInfo> {
    #[cfg(target_os = "windows")]
    {
        let candidates: &[(&str, &str)] = &[
            ("PowerShell", "powershell.exe"),
            ("PowerShell Core", "pwsh.exe"),
            ("Command Prompt", "cmd.exe"),
            ("WSL", "wsl.exe"),
        ];
        let default_shell = get_default_shell();
        let mut seen = std::collections::HashSet::new();
        let mut shells = Vec::new();

        if let Some(resolved_path) = resolve_git_bash() {
            seen.insert("Git Bash".to_string());
            shells.push(ShellInfo {
                name: "Git Bash".to_string(),
                path: resolved_path.clone(),
                is_default: resolved_path.eq_ignore_ascii_case(&default_shell),
            });
        }

        for (name, path) in candidates {
            if let Ok(resolved_path) = which::which(path) {
                let resolved_path = resolved_path.to_string_lossy().to_string();
                if !seen.insert(name.to_string()) {
                    continue;
                }

                shells.push(ShellInfo {
                    name: name.to_string(),
                    path: resolved_path.clone(),
                    is_default: resolved_path.eq_ignore_ascii_case(&default_shell),
                });
            }
        }
        return shells;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let default_shell = get_default_shell();
        let mut seen_paths = std::collections::HashSet::new();
        let mut shells = Vec::new();

        // Read /etc/shells (same as VS Code: terminalProfiles.ts detectAvailableUnixProfiles)
        if let Ok(contents) = std::fs::read_to_string("/etc/shells") {
            for line in contents.lines() {
                let trimmed = if let Some(idx) = line.find('#') {
                    &line[..idx]
                } else {
                    line
                };
                let trimmed = trimmed.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let path = std::path::Path::new(trimmed);
                if path.exists() && seen_paths.insert(trimmed.to_string()) {
                    let name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("sh")
                        .to_string();
                    shells.push(ShellInfo {
                        name: name.clone(),
                        path: trimmed.to_string(),
                        is_default: trimmed == default_shell
                            || path.file_name().and_then(|n| n.to_str())
                                == std::path::Path::new(&default_shell)
                                    .file_name()
                                    .and_then(|n| n.to_str()),
                    });
                }
            }
        }

        // Fallback if /etc/shells wasn't readable
        if shells.is_empty() {
            let candidates: &[(&str, &str)] = &[
                ("zsh", "/bin/zsh"),
                ("bash", "/bin/bash"),
                ("fish", "/usr/bin/fish"),
                ("fish", "/usr/local/bin/fish"),
                ("fish", "/opt/homebrew/bin/fish"),
                ("sh", "/bin/sh"),
            ];
            let mut seen_names = std::collections::HashSet::new();
            for (name, shell_path) in candidates {
                if std::path::Path::new(shell_path).exists() && seen_names.insert(name.to_string())
                {
                    shells.push(ShellInfo {
                        name: name.to_string(),
                        path: shell_path.to_string(),
                        is_default: *shell_path == default_shell,
                    });
                }
            }
        }

        shells
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub is_default: bool,
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn get_shell_integration_dir(app: tauri::AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;
    let scripts_dir = resource_dir.join("shell-integration");
    Ok(scripts_dir.to_string_lossy().to_string())
}

#[tauri::command]
#[allow(clippy::too_many_lines, clippy::needless_pass_by_value)]
pub fn setup_zsh_dotdir(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let zdotdir = data_dir.join("zsh-integration");
    std::fs::create_dir_all(&zdotdir).map_err(|e| format!("Failed to create zdotdir: {e}"))?;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;
    let scripts_dir = resource_dir.join("shell-integration");

    let zshrc_content = format!(
        r#"# ScCode Shell Integration - Auto-generated
VSCODE_SHELL_INTEGRATION=1
VSCODE_INJECTION=1
if [[ -f "{scripts}/shellIntegration-rc.zsh" ]]; then
    USER_ZDOTDIR="${{ZDOTDIR:-$HOME}}"
    . "{scripts}/shellIntegration-rc.zsh"
fi
"#,
        scripts = scripts_dir.to_string_lossy()
    );

    let zshrc_path = zdotdir.join(".zshrc");
    std::fs::write(&zshrc_path, zshrc_content)
        .map_err(|e| format!("Failed to write .zshrc: {e}"))?;

    let zshenv_content = format!(
        r#"# ScCode Shell Integration - Auto-generated
USER_ZDOTDIR="${{ZDOTDIR:-$HOME}}"
if [[ -f "{scripts}/shellIntegration-env.zsh" ]]; then
    . "{scripts}/shellIntegration-env.zsh"
fi
"#,
        scripts = scripts_dir.to_string_lossy()
    );

    let zshenv_path = zdotdir.join(".zshenv");
    std::fs::write(&zshenv_path, zshenv_content)
        .map_err(|e| format!("Failed to write .zshenv: {e}"))?;

    let zprofile_content = format!(
        r#"# ScCode Shell Integration - Auto-generated
if [[ -f "{scripts}/shellIntegration-profile.zsh" ]]; then
    . "{scripts}/shellIntegration-profile.zsh"
fi
"#,
        scripts = scripts_dir.to_string_lossy()
    );

    let zprofile_path = zdotdir.join(".zprofile");
    std::fs::write(&zprofile_path, zprofile_content)
        .map_err(|e| format!("Failed to write .zprofile: {e}"))?;

    let zlogin_content = format!(
        r#"# ScCode Shell Integration - Auto-generated
if [[ -f "{scripts}/shellIntegration-login.zsh" ]]; then
    . "{scripts}/shellIntegration-login.zsh"
fi
"#,
        scripts = scripts_dir.to_string_lossy()
    );

    let zlogin_path = zdotdir.join(".zlogin");
    std::fs::write(&zlogin_path, zlogin_content)
        .map_err(|e| format!("Failed to write .zlogin: {e}"))?;

    Ok(zdotdir.to_string_lossy().to_string())
}

#[cfg(test)]
mod stream_tests {
    use super::*;

    #[test]
    fn events_serialize_with_the_frontend_field_names() {
        let exit = serde_json::to_value(TerminalEvent::Exit { exit_code: 3 }).unwrap();
        assert_eq!(exit, serde_json::json!({ "kind": "exit", "exitCode": 3 }));
        let data = serde_json::to_value(TerminalEvent::Data { data: "x".into() }).unwrap();
        assert_eq!(data, serde_json::json!({ "kind": "data", "data": "x" }));
    }

    #[test]
    fn utf8_split_across_chunks_is_reassembled() {
        let bytes = "中文输出".as_bytes();
        let mut stream = Utf8Stream::default();
        let mut text = String::new();
        // Split inside every multi-byte character.
        for chunk in bytes.chunks(2) {
            text.push_str(&stream.decode(chunk));
        }
        text.push_str(&stream.finish());
        assert_eq!(text, "中文输出");
        assert!(!text.contains('\u{FFFD}'));
    }

    #[test]
    fn invalid_bytes_are_still_replaced() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.decode(b"a\xffb"), "a\u{FFFD}b");
        assert_eq!(stream.decode(b"\xe4\xb8"), "");
        assert_eq!(stream.finish(), "\u{FFFD}");
    }

    #[test]
    fn flow_control_pauses_until_acknowledged() {
        let flow = Arc::new(FlowControl::default());
        flow.sent(HIGH_WATERMARK_CHARS + 1);
        let waiter = {
            let flow = Arc::clone(&flow);
            std::thread::spawn(move || {
                let started = Instant::now();
                flow.wait_for_capacity(Duration::from_secs(10));
                started.elapsed()
            })
        };
        std::thread::sleep(Duration::from_millis(100));
        flow.ack(HIGH_WATERMARK_CHARS);
        let waited = waiter.join().unwrap();
        assert!(waited >= Duration::from_millis(90) && waited < Duration::from_secs(5));
    }

    #[test]
    fn flow_control_gives_up_after_max_pause_and_on_close() {
        let flow = FlowControl::default();
        flow.sent(HIGH_WATERMARK_CHARS * 2);
        let started = Instant::now();
        flow.wait_for_capacity(Duration::from_millis(50));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(*flow.unacked.lock().unwrap(), 0);

        flow.sent(HIGH_WATERMARK_CHARS * 2);
        flow.close();
        flow.wait_for_capacity(Duration::from_secs(10));
    }
}
