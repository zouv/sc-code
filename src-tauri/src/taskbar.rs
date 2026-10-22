//! Windows taskbar jump list integration.
//!
//! The workbench reports its recently opened folders/workspaces to
//! [`taskbar_update_jump_list`], and this module publishes them as the
//! application's taskbar jump list. Clicking an entry starts the app with
//! `--open-folder=<base64 uri>` or `--open-workspace=<base64 uri>`; the
//! single-instance forwarder sends those arguments to the running window.
//!
//! The Win32 shell API is COM based and therefore unavoidable `unsafe` code.
//! All of it is deliberately confined to `windows_impl` and
//! `windows_single_instance` below; the URI parsing/validation and the Tauri
//! command boundary stay safe.

#![allow(unsafe_code)]

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use std::collections::HashSet;

const MAX_ENTRIES: usize = 10;
const MAX_LABEL_CHARS: usize = 80;
// Keep the base64-encoded jump-list argument comfortably below CreateProcess's
// ~32K command-line limit.
const MAX_URI_LENGTH: usize = 16_384;

#[derive(Debug, Clone, Deserialize)]
pub struct JumpListEntry {
    pub kind: String,
    pub uri: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    Folder,
    Workspace,
}

impl TargetKind {
    fn query_name(self) -> &'static str {
        match self {
            Self::Folder => "folder",
            Self::Workspace => "workspace",
        }
    }

    fn flag(self) -> &'static str {
        match self {
            Self::Folder => "--open-folder=",
            Self::Workspace => "--open-workspace=",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenTarget {
    pub kind: TargetKind,
    pub uri: String,
}

impl OpenTarget {
    /// Query string understood by `src/main.ts` when the workbench boots.
    pub fn app_url(&self) -> String {
        format!(
            "index.html?{}={}",
            self.kind.query_name(),
            urlencoding::encode(&self.uri)
        )
    }

    fn argument(&self) -> String {
        format!(
            "{}{}",
            self.kind.flag(),
            URL_SAFE_NO_PAD.encode(self.uri.as_bytes())
        )
    }
}

#[derive(Debug, Clone)]
struct PreparedEntry {
    kind: TargetKind,
    uri: String,
    label: String,
}

impl PreparedEntry {
    fn argument(&self) -> String {
        OpenTarget {
            kind: self.kind,
            uri: self.uri.clone(),
        }
        .argument()
    }
}

/// Parse a launch target from process arguments. Unknown or invalid arguments
/// are ignored so a manually edited shortcut cannot inject arbitrary schemes.
pub fn parse_open_target(args: &[String]) -> Option<OpenTarget> {
    for arg in args {
        let (kind, encoded) = if let Some(value) = arg.strip_prefix(TargetKind::Folder.flag()) {
            (TargetKind::Folder, value)
        } else if let Some(value) = arg.strip_prefix(TargetKind::Workspace.flag()) {
            (TargetKind::Workspace, value)
        } else {
            continue;
        };

        let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
        let uri = String::from_utf8(bytes).ok()?;
        if !is_supported_uri(&uri) {
            continue;
        }

        return Some(OpenTarget { kind, uri });
    }

    None
}

/// Update the Windows jump list. No-op on other platforms.
#[tauri::command]
pub fn taskbar_update_jump_list(entries: Vec<JumpListEntry>) -> Result<(), String> {
    let prepared = prepare_entries(entries);
    platform_update(&prepared)
}

fn prepare_entries(entries: Vec<JumpListEntry>) -> Vec<PreparedEntry> {
    let mut seen = HashSet::new();
    let mut prepared = Vec::new();

    for entry in entries {
        if prepared.len() >= MAX_ENTRIES {
            break;
        }

        let kind = match entry.kind.as_str() {
            "folder" => TargetKind::Folder,
            "workspace" => TargetKind::Workspace,
            _ => continue,
        };

        if !is_supported_uri(&entry.uri) {
            continue;
        }

        // Windows paths are case-insensitive; de-duplicate without letting the
        // same folder appear once per window/startup.
        let key = format!("{kind:?}\u{0}{}", entry.uri.to_ascii_lowercase());
        if !seen.insert(key) {
            continue;
        }

        let label = clean_label(&entry.label)
            .or_else(|| fallback_label(&entry.uri))
            .unwrap_or_else(|| "Untitled".to_string());

        prepared.push(PreparedEntry {
            kind,
            uri: entry.uri,
            label,
        });
    }

    prepared
}

fn is_supported_uri(uri: &str) -> bool {
    uri.len() <= MAX_URI_LENGTH
        && uri
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
}

fn clean_label(label: &str) -> Option<String> {
    let label = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.is_empty() {
        return None;
    }

    let mut chars = label.chars();
    let truncated: String = chars.by_ref().take(MAX_LABEL_CHARS).collect();
    if chars.next().is_some() {
        Some(format!("{truncated}…"))
    } else {
        Some(truncated)
    }
}

fn fallback_label(uri: &str) -> Option<String> {
    let url = url::Url::parse(uri).ok()?;
    let path = url.to_file_path().ok()?;
    let name = path.file_name()?.to_string_lossy();
    let name = name.strip_suffix(".code-workspace").unwrap_or(&name);
    clean_label(name)
}

#[cfg(windows)]
fn platform_update(entries: &[PreparedEntry]) -> Result<(), String> {
    windows_impl::update(entries)
}

#[cfg(not(windows))]
fn platform_update(_entries: &[PreparedEntry]) -> Result<(), String> {
    Ok(())
}

/// Claim the per-profile single-instance mutex. Returns `false` when another
/// process already owns it and this process should exit.
#[cfg(windows)]
pub fn ensure_single_instance() -> bool {
    windows_single_instance::ensure()
}

#[cfg(not(windows))]
pub fn ensure_single_instance() -> bool {
    true
}

/// Create the hidden window used to receive forwarded launch arguments.
#[cfg(windows)]
pub fn install_single_instance(app: &tauri::AppHandle) -> Result<(), String> {
    windows_single_instance::install(app)
}

#[cfg(not(windows))]
pub fn install_single_instance(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

/// Release the single-instance mutex and hidden message window on exit.
#[cfg(windows)]
pub fn destroy_single_instance() {
    windows_single_instance::destroy();
}

#[cfg(not(windows))]
pub fn destroy_single_instance() {}

#[cfg(windows)]
mod windows_impl {
    use super::PreparedEntry;
    use std::sync::Mutex;
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
    };

    static UPDATE_LOCK: Mutex<()> = Mutex::new(());

    struct ComGuard {
        uninitialize: bool,
    }

    impl ComGuard {
        fn new() -> Self {
            // RPC_E_CHANGED_MODE means COM is already initialized on this
            // thread in another apartment; shell calls can still proceed.
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            Self {
                uninitialize: hr.is_ok(),
            }
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.uninitialize {
                unsafe { CoUninitialize() };
            }
        }
    }

    pub fn update(entries: &[PreparedEntry]) -> Result<(), String> {
        let _guard = UPDATE_LOCK
            .lock()
            .map_err(|_| "taskbar jump list lock poisoned".to_string())?;
        let entries = entries.to_vec();

        // ICustomDestinationList requires an STA. Tauri commands may run on a
        // worker thread that is already MTA, so use a dedicated thread whose
        // apartment is fully under our control.
        std::thread::Builder::new()
            .name("sc-code-jump-list".to_string())
            .spawn(move || {
                let _com = ComGuard::new();
                unsafe { update_inner(&entries) }
            })
            .map_err(|error| format!("cannot start jump list thread: {error}"))?
            .join()
            .map_err(|_| "jump list thread panicked".to_string())?
    }

    unsafe fn update_inner(entries: &[PreparedEntry]) -> Result<(), String> {
        let destination: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| format!("cannot create jump list: {error}"))?;

        if entries.is_empty() {
            destination
                .DeleteList(PCWSTR::null())
                .map_err(|error| format!("cannot clear jump list: {error}"))?;
            return Ok(());
        }

        let mut minimum_slots = 0u32;
        let _removed: IObjectArray = destination
            .BeginList(&raw mut minimum_slots)
            .map_err(|error| format!("cannot begin jump list: {error}"))?;

        let executable = std::env::current_exe()
            .map_err(|error| format!("cannot resolve executable: {error}"))?;
        let executable = HSTRING::from(executable.to_string_lossy().as_ref());

        append_category(
            &destination,
            &executable,
            "Recent Folders",
            entries
                .iter()
                .filter(|entry| entry.kind == super::TargetKind::Folder),
        )?;
        append_category(
            &destination,
            &executable,
            "Recent Workspaces",
            entries
                .iter()
                .filter(|entry| entry.kind == super::TargetKind::Workspace),
        )?;

        destination
            .CommitList()
            .map_err(|error| format!("cannot commit jump list: {error}"))?;
        Ok(())
    }

    unsafe fn append_category<'a>(
        destination: &ICustomDestinationList,
        executable: &HSTRING,
        title: &str,
        entries: impl Iterator<Item = &'a PreparedEntry>,
    ) -> Result<(), String> {
        let collection: IObjectCollection =
            CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| format!("cannot create jump list category: {error}"))?;

        let mut count = 0usize;
        for entry in entries {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| format!("cannot create jump list item: {error}"))?;
            let arguments = HSTRING::from(entry.argument());
            let label = HSTRING::from(entry.label.as_str());

            link.SetPath(executable)
                .map_err(|error| format!("cannot set jump list target: {error}"))?;
            link.SetArguments(&arguments)
                .map_err(|error| format!("cannot set jump list arguments: {error}"))?;
            link.SetDescription(&label)
                .map_err(|error| format!("cannot set jump list description: {error}"))?;
            link.SetIconLocation(executable, 0)
                .map_err(|error| format!("cannot set jump list icon: {error}"))?;

            let properties: IPropertyStore = link
                .cast()
                .map_err(|error| format!("cannot open jump list properties: {error}"))?;
            let title_value = PROPVARIANT::from(entry.label.as_str());
            let title_key = PKEY_Title;
            properties
                .SetValue(&raw const title_key, &raw const title_value)
                .map_err(|error| format!("cannot set jump list title: {error}"))?;
            properties
                .Commit()
                .map_err(|error| format!("cannot commit jump list item: {error}"))?;

            collection
                .AddObject(&link)
                .map_err(|error| format!("cannot add jump list item: {error}"))?;
            count += 1;
        }

        if count == 0 {
            return Ok(());
        }

        let object_array: IObjectArray = collection
            .cast()
            .map_err(|error| format!("cannot finalize jump list category: {error}"))?;
        destination
            .AppendCategory(&HSTRING::from(title), &object_array)
            .map_err(|error| format!("cannot append jump list category: {error}"))?;
        Ok(())
    }
}

#[cfg(windows)]
mod windows_single_instance {
    use std::ffi::c_void;
    use std::hash::{Hash, Hasher};
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::time::Duration;
    use tauri::{AppHandle, Manager};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, SetLastError, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
        ERROR_ALREADY_EXISTS, WIN32_ERROR,
    };
    use windows::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, CREATESTRUCTW, CreateWindowExW, DefWindowProcW, FindWindowW,
        GetWindowLongPtrW, GetWindowThreadProcessId, RegisterClassExW, SendMessageTimeoutW,
        SetWindowLongPtrW, GWL_STYLE, GWLP_USERDATA, SMTO_NORMAL, WM_COPYDATA, WM_CREATE,
        WM_DESTROY, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TRANSPARENT, WS_OVERLAPPED, WS_POPUP, WS_VISIBLE,
    };

    const FORWARD_TIMEOUT_MS: u32 = 10_000;
    const FORWARD_RETRIES: u32 = 50;
    const FORWARD_RETRY_DELAY_MS: u64 = 100;

    static MUTEX_HANDLE: AtomicIsize = AtomicIsize::new(0);
    static MESSAGE_WINDOW: AtomicIsize = AtomicIsize::new(0);

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn instance_id() -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        crate::app_dirs::resolve_app_data_dir().hash(&mut hasher);
        hasher.finish()
    }

    fn class_name() -> String {
        format!("ScCodeSingleInstance-{:016x}", instance_id())
    }

    fn window_name() -> String {
        format!("ScCodeSingleInstanceWindow-{:016x}", instance_id())
    }

    pub fn ensure() -> bool {
        let mutex_name = wide(&format!("Local\\{}-mutex", class_name()));
        unsafe { SetLastError(WIN32_ERROR(0)) };
        let handle = match unsafe {
            CreateMutexW(None, true, PCWSTR(mutex_name.as_ptr()))
        } {
            Ok(handle) => handle,
            Err(error) => {
                // Fail open: an unavailable kernel mutex must not prevent the
                // editor from starting.
                log::warn!("single-instance mutex unavailable: {error}");
                return true;
            }
        };

        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe { let _ = CloseHandle(handle); };
            forward_to_running_instance();
            return false;
        }

        MUTEX_HANDLE.store(handle.0 as isize, Ordering::Release);
        true
    }

    fn forward_to_running_instance() {
        let args: Vec<String> = std::env::args_os()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();

        // The first instance may still be in setup; retry briefly so an
        // immediately following jump-list click is not lost.
        for attempt in 0..=FORWARD_RETRIES {
            if send_arguments(&args) {
                return;
            }
            if attempt < FORWARD_RETRIES {
                std::thread::sleep(Duration::from_millis(FORWARD_RETRY_DELAY_MS));
            }
        }

        log::warn!("single-instance target window not found; exiting second instance");
    }

    fn send_arguments(args: &[String]) -> bool {
        let class_name = wide(&class_name());
        let window_title = wide(&window_name());
        let hwnd = match unsafe {
            FindWindowW(PCWSTR(class_name.as_ptr()), PCWSTR(window_title.as_ptr()))
        } {
            Ok(hwnd) if !hwnd.0.is_null() => hwnd,
            _ => return false,
        };

        let mut process_id = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&raw mut process_id)) };
        if process_id != 0 {
            let _ = unsafe { AllowSetForegroundWindow(process_id) };
        }

        let payload = args.join("\u{0}");
        let bytes = payload.as_bytes();
        let data = COPYDATASTRUCT {
            dwData: 1,
            cbData: u32::try_from(bytes.len()).unwrap_or(u32::MAX),
            lpData: bytes.as_ptr().cast_mut().cast::<c_void>(),
        };
        let sent = unsafe {
            SendMessageTimeoutW(
                hwnd,
                WM_COPYDATA,
                WPARAM(0),
                LPARAM((&raw const data).cast::<c_void>() as isize),
                SMTO_NORMAL,
                FORWARD_TIMEOUT_MS,
                None,
            )
        };
        sent.0 != 0
    }

    pub fn install(app: &AppHandle) -> Result<(), String> {
        if MESSAGE_WINDOW.load(Ordering::Acquire) != 0 {
            return Ok(());
        }
        let class_name = wide(&class_name());
        let window_title = wide(&window_name());
        let module = unsafe { GetModuleHandleW(PCWSTR::null()) }
            .map_err(|error| format!("cannot get module handle: {error}"))?;

        let window_class = WNDCLASSEXW {
            cbSize: u32::try_from(std::mem::size_of::<WNDCLASSEXW>()).unwrap_or(u32::MAX),
            lpfnWndProc: Some(window_proc),
            hInstance: HINSTANCE(module.0),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        if unsafe { RegisterClassExW(&raw const window_class) } == 0 {
            return Err("cannot register single-instance window class".to_string());
        }

        let userdata = Box::into_raw(Box::new(app.clone()));
        let window = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW,
                PCWSTR(class_name.as_ptr()),
                PCWSTR(window_title.as_ptr()),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(HINSTANCE(module.0)),
                Some(userdata.cast()),
            )
        };

        let window = match window {
            Ok(window) => window,
            Err(error) => {
                drop(unsafe { Box::from_raw(userdata) });
                return Err(format!("cannot create single-instance window: {error}"));
            }
        };

        // The window has to be visible to receive resize/paint notifications,
        // but the layered + tool-window styles keep it out of sight and out of
        // the taskbar.
        unsafe {
            SetWindowLongPtrW(
                window,
                GWL_STYLE,
                isize::try_from((WS_VISIBLE | WS_POPUP).0).unwrap_or(isize::MAX),
            );
        }
        MESSAGE_WINDOW.store(window.0 as isize, Ordering::Release);
        Ok(())
    }

    pub fn destroy() {
        let window = MESSAGE_WINDOW.swap(0, Ordering::AcqRel);
        if window != 0 {
            let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::DestroyWindow(HWND(window as *mut c_void)) };
        }

        let mutex = MUTEX_HANDLE.swap(0, Ordering::AcqRel);
        if mutex != 0 {
            let _ = unsafe { CloseHandle(windows::Win32::Foundation::HANDLE(mutex as *mut c_void)) };
        }
    }

    fn dispatch(app: &AppHandle, args: &[String]) {
        let target = super::parse_open_target(args);
        let app_for_task = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(target) = target {
                if let Err(error) =
                    crate::commands::window::open_target_window(&app_for_task, &target)
                {
                    log::warn!("failed to open jump list target: {error}");
                }
                return;
            }

            if let Some(window) = app_for_task.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        });
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_CREATE => {
                let create = unsafe { &*(lparam.0 as *const CREATESTRUCTW) };
                unsafe {
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
                }
                LRESULT(0)
            }
            WM_COPYDATA => {
                let data = unsafe { &*(lparam.0 as *const COPYDATASTRUCT) };
                let bytes = if data.lpData.is_null() {
                    &[][..]
                } else {
                    unsafe {
                        std::slice::from_raw_parts(data.lpData.cast::<u8>(), data.cbData as usize)
                    }
                };
                let payload = String::from_utf8_lossy(bytes);
                let args: Vec<String> = payload
                    .split('\u{0}')
                    .filter(|arg| !arg.is_empty())
                    .map(ToString::to_string)
                    .collect();
                let userdata = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) };
                if userdata != 0 {
                    let app = unsafe { &*(userdata as *const AppHandle) };
                    dispatch(app, &args);
                }
                LRESULT(1)
            }
            WM_DESTROY => {
                let userdata = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) };
                if userdata != 0 {
                    drop(unsafe { Box::from_raw(userdata as *mut AppHandle) });
                }
                MESSAGE_WINDOW.store(0, Ordering::Release);
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arg(kind: TargetKind, uri: &str) -> String {
        OpenTarget {
            kind,
            uri: uri.to_string(),
        }
        .argument()
    }

    #[test]
    fn parses_folder_and_workspace_targets() {
        let folder = arg(TargetKind::Folder, "file:///C:/work/demo");
        let target = parse_open_target(&[folder]).expect("folder target");
        assert_eq!(target.kind, TargetKind::Folder);
        assert_eq!(target.uri, "file:///C:/work/demo");

        let workspace = arg(TargetKind::Workspace, "file:///C:/work/demo.code-workspace");
        let target = parse_open_target(&[workspace]).expect("workspace target");
        assert_eq!(target.kind, TargetKind::Workspace);
        assert_eq!(target.uri, "file:///C:/work/demo.code-workspace");
    }

    #[test]
    fn rejects_unknown_schemes_and_malformed_values() {
        assert!(parse_open_target(&["--open-folder=not-base64!".to_string()]).is_none());
        let https = arg(TargetKind::Folder, "https://example.com");
        assert!(parse_open_target(&[https]).is_none());
    }

    #[test]
    fn app_url_uses_the_workbench_query_parameters() {
        let target = OpenTarget {
            kind: TargetKind::Folder,
            uri: "file:///C:/work/demo folder".to_string(),
        };
        assert_eq!(
            target.app_url(),
            "index.html?folder=file%3A%2F%2F%2FC%3A%2Fwork%2Fdemo%20folder"
        );
    }

    #[test]
    fn prepares_entries_with_deduplication_and_labels() {
        let entries = vec![
            JumpListEntry {
                kind: "folder".to_string(),
                uri: "file:///C:/work/demo".to_string(),
                label: "  Demo\nFolder  ".to_string(),
            },
            JumpListEntry {
                kind: "folder".to_string(),
                uri: "file:///c:/work/demo".to_string(),
                label: "duplicate".to_string(),
            },
            JumpListEntry {
                kind: "workspace".to_string(),
                uri: "file:///C:/work/demo.code-workspace".to_string(),
                label: String::new(),
            },
            JumpListEntry {
                kind: "folder".to_string(),
                uri: "https://example.com".to_string(),
                label: "not local".to_string(),
            },
        ];

        let prepared = prepare_entries(entries);
        assert_eq!(prepared.len(), 2);
        assert_eq!(prepared[0].label, "Demo Folder");
        assert_eq!(prepared[1].label, "demo");
    }
}
