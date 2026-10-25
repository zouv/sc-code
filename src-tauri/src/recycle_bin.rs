//! Moves files to the operating system's recycle bin (VS Code `files.enableTrash`).
//!
//! Win32 `unsafe` stays inside `windows_impl`, mirroring `taskbar.rs`; commands only
//! call [`move_to_trash`].

use std::path::Path;

/// Whether this platform build can recycle files instead of deleting them.
pub const SUPPORTED: bool = cfg!(windows);

/// Moves `path` (file or directory, recursively) to the recycle bin.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("{}: SC_FILE_NOT_FOUND", path.display()));
    }
    #[cfg(windows)]
    {
        windows_impl::recycle(path)
    }
    #[cfg(not(windows))]
    {
        Err(format!("{}: moving to trash is not supported on this platform", path.display()))
    }
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod windows_impl {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW,
    };

    pub fn recycle(path: &Path) -> Result<(), String> {
        // pFrom is a list of NUL-terminated paths ended by an extra NUL; the shell API
        // does not accept `\\?\` verbatim prefixes.
        let display = path.to_string_lossy();
        let plain = display.strip_prefix(r"\\?\").unwrap_or(&display);
        let mut from: Vec<u16> = std::ffi::OsStr::new(plain).encode_wide().collect();
        from.extend([0, 0]);

        let mut op = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            // FOF_WANTNUKEWARNING: if an item cannot be recycled (e.g. network drive), the
            // shell asks before destroying it instead of deleting it silently.
            fFlags: (FOF_ALLOWUNDO.0
                | FOF_NOCONFIRMATION.0
                | FOF_NOERRORUI.0
                | FOF_SILENT.0
                | FOF_WANTNUKEWARNING.0) as u16,
            ..Default::default()
        };
        // SAFETY: `op` and the double-NUL-terminated `from` buffer outlive the call.
        let status = unsafe { SHFileOperationW(&mut op) };
        if status != 0 {
            return Err(format!("{}: moving to the recycle bin failed (shell error {status:#x})", path.display()));
        }
        if op.fAnyOperationsAborted.as_bool() {
            return Err(format!("{}: moving to the recycle bin was cancelled", path.display()));
        }
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "puts a temp file into the real user's recycle bin; run with --ignored"]
    fn recycles_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("recycle-me.txt");
        std::fs::write(&file, "x").unwrap();
        move_to_trash(&file).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn missing_file_reports_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let error = move_to_trash(&dir.path().join("missing.txt")).unwrap_err();
        assert!(error.contains("SC_FILE_NOT_FOUND"));
    }
}
