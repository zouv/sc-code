use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::State;
use tokio::sync::Semaphore;

use super::next_gen_tools::CheckpointStore;

/// Limit concurrent agent tool executions to prevent memory blowup from
/// parallel indexing/graph-building operations.
static TOOL_SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();

fn tool_semaphore() -> &'static Semaphore {
    TOOL_SEMAPHORE.get_or_init(|| Semaphore::new(2))
}

/// Tools that mutate files on disk; their targets must be snapshotted for
/// checkpoint rollback BEFORE execution.
fn is_write_tool(name: &str) -> bool {
    matches!(
        name,
        "edit_file"
            | "write_file"
            | "multi_edit"
            | "patch_file"
            | "regex_replace"
            | "notebook_edit"
            | "create_file"
            | "delete_file"
            | "str_replace_editor"
    )
}

/// Extract the target file path from a write tool's JSON arguments,
/// resolved against the request cwd.
fn extract_target_path(arguments: &str, cwd: &str) -> Option<String> {
    let args: serde_json::Value = serde_json::from_str(arguments).ok()?;
    let path = args
        .get("path")
        .or_else(|| args.get("file_path"))
        .and_then(|v| v.as_str())?;
    if std::path::Path::new(path).is_absolute() {
        Some(path.to_string())
    } else {
        Some(
            std::path::Path::new(cwd)
                .join(path)
                .to_string_lossy()
                .to_string(),
        )
    }
}

#[derive(Debug, Deserialize)]
pub struct AgentToolRequest {
    pub tool_call_id: String,
    pub name: String,
    pub arguments: String,
    pub cwd: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub checkpoint_scope: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentToolResponse {
    pub tool_call_id: String,
    pub output: String,
    pub error: String,
}

#[tauri::command]
pub async fn agent_execute_tool(
    checkpoint_state: State<'_, CheckpointStore>,
    request: AgentToolRequest,
) -> Result<AgentToolResponse, String> {
    let fallback_id = request.tool_call_id.clone();

    let _permit = match tool_semaphore().acquire().await {
        Ok(p) => p,
        Err(_) => {
            return Ok(AgentToolResponse {
                tool_call_id: fallback_id,
                output: String::new(),
                error: "tool execution semaphore closed".to_string(),
            });
        }
    };

    let journal = checkpoint_state.journal.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = request.checkpoint_scope.as_deref().unwrap_or("legacy");
        let target = if is_write_tool(&request.name) {
            Some(extract_target_path(&request.arguments, &request.cwd).ok_or("Write tool target path is required")?)
        } else { None };
        // One lock orders snapshots, file tools, post-images and rollback/create.
        // Read-only/opaque tools do not hold the global checkpoint mutex.
        // Shell/Git/worktree mutations are NOT part of this file journal.
        let mut guard = if target.is_some() { Some(journal.lock().map_err(|e| e.to_string())?) } else { None };
        if let Some(path) = &target {
            guard.as_mut().expect("mutation guard").track_before(scope, std::path::Path::new(path)).map_err(|e| e.to_string())?;
        }
        let ctx = sidex_agent::ToolContext {
            cwd: request.cwd.clone(),
            token: request.token.clone(),
        };
        let req = sidex_agent::ToolRequest {
            tool_call_id: request.tool_call_id.clone(),
            name: request.name,
            arguments: request.arguments,
        };
        let resp = sidex_agent::execute(&req, &ctx);
        if let Some(path) = &target {
            guard.as_mut().expect("mutation guard").record_after(scope, std::path::Path::new(path)).map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(AgentToolResponse {
            tool_call_id: resp.tool_call_id,
            output: resp.output,
            error: resp.error,
        })
    })
    .await;

    Ok(result.map_err(|e| format!("internal error: {e}")).and_then(|response| response).unwrap_or_else(|e| AgentToolResponse {
        tool_call_id: fallback_id,
        output: String::new(),
        error: format!("internal error: {e}"),
    }))
}
