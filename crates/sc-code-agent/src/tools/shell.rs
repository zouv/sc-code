use super::{get_int, get_str, get_str_or, resolve_path, Args};
use crate::ToolContext;
use anyhow::{bail, Result};
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const OUTPUT_LIMIT: usize = 100_000;
// Drain both streams concurrently even after the output budget has been reached.
// Waiting before reading can deadlock when the child's pipe buffer fills.
fn drain(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut result = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let keep = count.min(OUTPUT_LIMIT.saturating_sub(result.len()));
        result.extend_from_slice(&buffer[..keep]);
    }
    Ok(result)
}

pub fn run(args: &Args, ctx: &ToolContext) -> Result<String> {
    let command = get_str(args, "command");
    if command.is_empty() {
        bail!("command is required");
    }
    let timeout_sec = get_int(args, "timeout", 30).clamp(1, 300) as u64;
    let work_dir = resolve_path(ctx, get_str_or(args, "working_directory", &ctx.cwd));
    if !std::path::Path::new(&work_dir).is_dir() {
        bail!("working_directory {work_dir:?} does not exist");
    }
    #[cfg(windows)]
    let mut process = {
        use std::os::windows::process::CommandExt;
        let mut process = Command::new("powershell.exe");
        process.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command,
        ]);
        process.creation_flags(0x08000000); // CREATE_NO_WINDOW
        process
    };
    #[cfg(not(windows))]
    let mut process = {
        use std::os::unix::process::CommandExt;
        let mut process = Command::new("sh");
        process.args(["-c", command]);
        process.process_group(0); // isolate timeout cleanup from other shell sessions
        process
    };
    let mut child = process
        .current_dir(work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn: {e}"))?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out_thread = thread::spawn(move || drain(stdout));
    let err_thread = thread::spawn(move || drain(stderr));
    let started = Instant::now();
    let deadline = Duration::from_secs(timeout_sec);
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= deadline {
            // Kill a still-running process tree; never retain a watchdog with a reusable PID.
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill.exe")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x08000000)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            // Reader handles may outlive this call if escaped descendants retain pipes.
            bail!("command timed out after {timeout_sec}s and was killed");
        }
        thread::sleep(Duration::from_millis(20));
    };
    // A detached descendant can keep inherited pipes open even after the shell exits.
    while !(out_thread.is_finished() && err_thread.is_finished()) {
        if started.elapsed() >= deadline {
            bail!("command output pipes did not close before timeout");
        }
        thread::sleep(Duration::from_millis(20));
    }
    let stdout = out_thread
        .join()
        .map_err(|_| anyhow::anyhow!("stdout reader failed"))??;
    let stderr = err_thread
        .join()
        .map_err(|_| anyhow::anyhow!("stderr reader failed"))??;
    let mut bytes = stdout;
    bytes.extend(stderr);
    let truncated = bytes.len() >= OUTPUT_LIMIT;
    bytes.truncate(OUTPUT_LIMIT);
    let mut result = String::from_utf8_lossy(&bytes).into_owned();
    if truncated {
        result.push_str("\n...(truncated)");
    }
    if let Some(code) = status.code().filter(|_| !status.success()) {
        result.push_str(&format!("\nexit code: {code}"));
    }
    if result.is_empty() {
        result = "(command produced no output)".into();
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drains_output_larger_than_pipe_without_deadlock() {
        let tmp = tempfile::tempdir().unwrap();
        let command = if cfg!(windows) {
            "$s='x'*1024; 1..256 | ForEach-Object { [Console]::WriteLine($s) }"
        } else {
            "i=0; while [ $i -lt 20000 ]; do echo xxxxxxxxxxxxxxxx; i=$((i+1)); done"
        };
        let mut args = Args::new();
        args.insert("command".into(), serde_json::json!(command));
        let result = run(
            &args,
            &ToolContext {
                cwd: tmp.path().to_string_lossy().into_owned(),
                token: String::new(),
            },
        )
        .unwrap();
        assert!(result.contains("(truncated)"));
        assert!(result.len() < OUTPUT_LIMIT + 100);
    }
    #[test]
    fn timeout_terminates_long_running_child() {
        let tmp = tempfile::tempdir().unwrap();
        let command = if cfg!(windows) {
            "Start-Sleep -Seconds 10"
        } else {
            "sleep 10"
        };
        let mut args = Args::new();
        args.insert("command".into(), serde_json::json!(command));
        args.insert("timeout".into(), serde_json::json!(1));
        let start = Instant::now();
        assert!(run(
            &args,
            &ToolContext {
                cwd: tmp.path().to_string_lossy().into_owned(),
                token: String::new()
            }
        )
        .unwrap_err()
        .to_string()
        .contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(7));
    }
}
