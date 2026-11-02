//! Restricted mode is an execution guard, NOT a filesystem/Node sandbox.
//! The workbench trust service controls authorization per window. A compromised
//! top-level renderer is outside this boundary; untrusted extension frames are
//! rejected separately by ipc_guard.
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State, WebviewWindow};

struct PermissionSession {
    id: String,
    revision: u64,
    trusted: bool,
}
#[derive(Default)]
pub struct WorkspacePermissions {
    sessions: Mutex<HashMap<String, PermissionSession>>,
}
impl WorkspacePermissions {
    pub fn reset(&self, window: &str) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .map_err(|_| "workspace permission lock failed")?
            .insert(
                window.to_owned(),
                PermissionSession {
                    id: id.clone(),
                    revision: 0,
                    trusted: false,
                },
            );
        Ok(id)
    }
    pub fn remove(&self, window: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(window);
        }
    }
    pub fn set_trusted(
        &self,
        window: &str,
        session: &str,
        revision: u64,
        trusted: bool,
    ) -> Result<bool, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "workspace permission lock failed")?;
        let current = sessions
            .get_mut(window)
            .ok_or("workspace permission session missing")?;
        if current.id != session {
            return Err("stale workspace permission session".into());
        }
        if revision <= current.revision {
            return Ok(false);
        }
        current.revision = revision;
        current.trusted = trusted;
        Ok(true)
    }
    pub fn allows(&self, window: &str, command: &str) -> bool {
        !requires_trust(command)
            || self
                .sessions
                .lock()
                .is_ok_and(|sessions| sessions.get(window).is_some_and(|session| session.trusted))
    }
}

/// Keep cleanup and normal editing available in restricted mode. All known
/// execution entry points, both extension hosts and writes to existing process
/// channels must be gated (not only process creation).
fn requires_trust(command: &str) -> bool {
    command.starts_with("git_")
        || command.starts_with("wasm_")
        || matches!(
            command,
            "exec"
                | "env_shell"
                | "get_env"
                | "get_all_env"
                | "terminal_spawn"
                | "terminal_write"
                | "term_spawn"
                | "term_write"
                | "term_signal"
                | "term_set_cwd"
                | "debug_spawn_adapter"
                | "debug_send"
                | "dap_start_adapter"
                | "dap_send_request"
                | "task_spawn"
                | "orch_start"
                | "orch_add_tasks"
                | "orch_spawn_task"
                | "lsp_start_server"
                | "lsp_send_request"
                | "lsp_send_notification"
                | "start_extension_host"
                | "real_ext_host_start"
                | "extension_platform_bootstrap"
                | "extension_platform_restart"
                | "extension_platform_init_data"
                | "agent_execute_tool"
                | "ext_api_call"
                | "providers_detect_cli"
                | "accounts_connect"
                | "server_endpoint"
                | "server_restart"
                | "remote_connect_ssh"
                | "remote_exec_ssh"
                | "remote_connect_wsl"
                | "remote_connect_container"
                | "remote_connect_codespace"
                | "mcp_connect"
                | "mcp_call_tool"
                | "mcp_add_server"
                | "mcp_reload_config"
                | "hooks_trigger"
                | "hooks_test"
                | "hooks_add"
                | "hooks_toggle"
                | "hooks_reload"
                | "browser_navigate"
                | "browser_click"
                | "browser_type"
                | "browser_eval"
                | "extension_secret"
                | "secret_get"
                | "secret_set"
                | "secret_delete"
                | "secret_keys"
        )
}

#[tauri::command]
pub fn workspace_reset_trust(
    window: WebviewWindow,
    state: State<'_, WorkspacePermissions>,
) -> Result<String, String> {
    let session = state.reset(window.label())?;
    stop_extension_hosts(&window);
    Ok(session)
}

#[tauri::command]
pub fn workspace_set_trust(
    window: WebviewWindow,
    state: State<'_, WorkspacePermissions>,
    session: String,
    revision: u64,
    trusted: bool,
) -> Result<(), String> {
    if state.set_trusted(window.label(), &session, revision, trusted)? && !trusted {
        stop_extension_hosts(&window);
    }
    Ok(())
}

fn stop_extension_hosts(window: &WebviewWindow) {
    // The legacy supervisor is shared: revoking one window conservatively
    // stops it globally. Real hosts can be stopped by window identity.
    if let Some(host) = window
        .app_handle()
        .try_state::<std::sync::Arc<crate::commands::real_ext_host::RealExtensionHost>>()
    {
        // Detach/stop the old generation before returning authorization to
        // the renderer. A queued shutdown could otherwise kill a newly granted host.
        host.shutdown_window(window.label());
    }
    if let Some(host) = window
        .app_handle()
        .try_state::<crate::commands::ext_host::ExtensionPlatformSupervisor>()
    {
        if let Err(error) = host.stop() {
            log::warn!("failed to stop restricted extension host: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_windows_fail_closed_for_both_hosts_and_process_channels() {
        let state = WorkspacePermissions::default();
        for command in [
            "real_ext_host_start",
            "start_extension_host",
            "extension_platform_bootstrap",
            "terminal_spawn",
            "terminal_write",
            "exec",
            "agent_execute_tool",
            "ext_api_call",
            "providers_detect_cli",
            "accounts_connect",
            "git_status",
            "mcp_call_tool",
            "remote_exec_ssh",
            "debug_send",
            "secret_get",
            "server_endpoint",
        ] {
            assert!(!state.allows("window-a", command), "{command}");
        }
        for command in [
            "read_file",
            "write_file",
            "search_files",
            "session_save_message",
            "settings_update",
            "terminal_kill",
            "task_kill",
            "dap_stop_adapter",
            "workspace_set_trust",
        ] {
            assert!(state.allows("window-a", command), "{command}");
        }
    }
    #[test]
    fn authorization_is_per_window_and_revocable() {
        let state = WorkspacePermissions::default();
        let session = state.reset("window-a").unwrap();
        state.set_trusted("window-a", &session, 1, true).unwrap();
        assert!(state.allows("window-a", "terminal_write"));
        assert!(!state.allows("window-b", "terminal_write"));
        state.set_trusted("window-a", &session, 2, false).unwrap();
        assert!(!state.allows("window-a", "terminal_write"));
        // A late grant cannot undo a later revoke or a workspace reload.
        assert!(!state.set_trusted("window-a", &session, 1, true).unwrap());
        let replacement = state.reset("window-a").unwrap();
        assert!(state.set_trusted("window-a", &session, 3, true).is_err());
        assert!(!state.allows("window-a", "terminal_write"));
        state
            .set_trusted("window-a", &replacement, 1, true)
            .unwrap();
        state.remove("window-a");
        assert!(!state.allows("window-a", "terminal_write"));
    }
}
