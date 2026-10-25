use serde::Serialize;
use std::path::Path;
use tauri::Manager;

use sc_code_workspace::file_ops as ws;

use super::validation::validate_path;

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct FileStat {
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub modified: u64,
    pub created: u64,
    pub readonly: bool,
}

fn io_err(path: &str, e: &sc_code_workspace::WorkspaceError) -> String {
    format!("{path}: {e}")
}

#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn read_file(path: String) -> Result<String, String> {
    validate_path(&path)?;
    ws::read_file(Path::new(&path)).map_err(|e| io_err(&path, &e))
}

/// Browser-rendered media (`<img>`, `<video>`, CSS `url()`) of a file the user
/// opened outside every workspace root. Any other file stays out of the asset
/// scope so reading it never makes it fetchable by page content.
const BROWSER_MEDIA_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif", "mp4", "webm", "ogg",
    "mp3", "wav", "flac", "m4a", "ttf", "otf", "woff", "woff2",
];

fn is_browser_media(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| BROWSER_MEDIA_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn read_file_bytes(app: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    validate_path(&path)?;
    let bytes = ws::read_file_bytes(Path::new(&path)).map_err(|e| io_err(&path, &e))?;
    if is_browser_media(Path::new(&path)) {
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|e| e.to_string())?;
    }
    Ok(bytes)
}

/// Binary read for the workbench file system provider: the bytes travel as a raw IPC
/// body (ArrayBuffer in JS) instead of a JSON number array.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn fs_read_binary(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    read_file_bytes(app, path).map(tauri::ipc::Response::new)
}

fn header_value<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Binary write counterpart of [`fs_read_binary`]. The body is the raw file content;
/// `sc-path` (percent-encoded UTF-8), `sc-create` and `sc-overwrite` (`1`/`0`) are headers.
#[tauri::command(async)]
pub fn fs_write_binary(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(content) = request.body() else {
        return Err("fs_write_binary expects a raw binary body".into());
    };
    let encoded = header_value(&request, "sc-path").ok_or("missing sc-path header")?;
    let path = urlencoding::decode(encoded)
        .map_err(|e| format!("invalid sc-path header: {e}"))?
        .into_owned();
    let flag = |name: &str| header_value(&request, name).is_none_or(|v| v != "0");
    validate_path(&path)?;
    ws::write_file_bytes_with_options(Path::new(&path), content, flag("sc-create"), flag("sc-overwrite"))
        .map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    validate_path(&path)?;
    ws::write_file(Path::new(&path), &content).map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn write_file_bytes(
    path: String,
    content: Vec<u8>,
    create: Option<bool>,
    overwrite: Option<bool>,
) -> Result<(), String> {
    validate_path(&path)?;
    ws::write_file_bytes_with_options(
        Path::new(&path),
        &content,
        create.unwrap_or(true),
        overwrite.unwrap_or(true),
    )
    .map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    validate_path(&path)?;
    let entries = ws::read_dir(Path::new(&path)).map_err(|e| io_err(&path, &e))?;

    Ok(entries
        .into_iter()
        .map(|e| DirEntry {
            name: e.name,
            path: e.path,
            is_dir: e.is_dir,
            is_file: e.is_file,
            is_symlink: e.is_symlink,
            size: e.size,
            modified: e.modified,
        })
        .collect())
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn stat(path: String) -> Result<FileStat, String> {
    validate_path(&path)?;
    let s = ws::stat(Path::new(&path)).map_err(|e| io_err(&path, &e))?;
    Ok(FileStat {
        size: s.size,
        is_dir: s.is_dir,
        is_file: s.is_file,
        is_symlink: s.is_symlink,
        modified: s.modified,
        created: s.created,
        readonly: s.readonly,
    })
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn mkdir(path: String, recursive: bool) -> Result<(), String> {
    validate_path(&path)?;
    ws::mkdir(Path::new(&path), recursive).map_err(|e| io_err(&path, &e))
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn remove(path: String, recursive: bool) -> Result<(), String> {
    validate_path(&path)?;
    ws::remove(Path::new(&path), recursive).map_err(|e| io_err(&path, &e))
}

/// Moves a file or folder to the recycle bin (`files.enableTrash`).
#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn fs_trash(path: String) -> Result<(), String> {
    validate_path(&path)?;
    crate::recycle_bin::move_to_trash(Path::new(&path))
}

/// Whether [`fs_trash`] is available on this platform.
#[tauri::command]
pub fn fs_trash_supported() -> bool {
    crate::recycle_bin::SUPPORTED
}

#[allow(clippy::needless_pass_by_value)]
#[tauri::command(async)]
pub fn rename(old_path: String, new_path: String) -> Result<(), String> {
    validate_path(&old_path)?;
    validate_path(&new_path)?;
    ws::rename(Path::new(&old_path), Path::new(&new_path))
        .map_err(|e| format!("{old_path} -> {new_path}: {e}"))
}

#[allow(clippy::needless_pass_by_value, clippy::unnecessary_wraps)]
#[tauri::command(async)]
pub fn exists(path: String) -> Result<bool, String> {
    validate_path(&path)?;
    Ok(ws::exists(Path::new(&path)))
}

/// Narrow browser resource delivery to opened workspaces; this is not an IPC sandbox.
/// The trusted workbench supplies roots parsed from .code-workspace JSONC.
#[tauri::command]
pub fn authorize_workspace_assets(app: tauri::AppHandle, roots: Vec<String>) -> Result<(), String> {
    if roots.len() > 64 {
        return Err("Too many workspace roots".into());
    }
    let mut canonical = Vec::new();
    for root in roots {
        validate_path(&root)?;
        let path = Path::new(&root).canonicalize().map_err(|e| e.to_string())?;
        if !path.is_dir() || path.parent().is_none() {
            return Err("Workspace root must be a directory, not filesystem root".into());
        }
        canonical.push(path);
    }
    for root in canonical {
        app.asset_protocol_scope()
            .allow_directory(root, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
