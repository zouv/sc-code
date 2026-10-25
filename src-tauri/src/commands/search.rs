use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use sc_code_workspace::search::{
    search_files as crate_search_files, FileSearchOptions as CrateFileSearchOptions, SearchEngine,
    SearchOptions as CrateSearchOptions, SearchQuery as CrateSearchQuery,
};

#[derive(Debug, Clone, Serialize)]
pub struct FileMatch {
    pub path: String,
    pub name: String,
    pub score: i64,
}

/// One match. `column` / `match_length` are UTF-16 code units (editor columns);
/// `line_content` may be a window of a very long line, with the match at `preview_column`.
#[derive(Debug, Clone, Serialize)]
pub struct TextMatch {
    pub path: String,
    pub line_number: usize,
    pub line_content: String,
    pub column: usize,
    pub match_length: usize,
    pub preview_column: usize,
}

#[derive(Debug, Deserialize)]
pub struct SearchFileOptions {
    pub max_results: Option<usize>,
    pub include_hidden: Option<bool>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct SearchTextOptions {
    pub max_results: Option<usize>,
    pub case_sensitive: Option<bool>,
    pub is_regex: Option<bool>,
    pub whole_word: Option<bool>,
    #[allow(dead_code)]
    pub include_hidden: Option<bool>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub max_file_size: Option<u64>,
    pub use_ignore_files: Option<bool>,
    pub follow_symlinks: Option<bool>,
    pub ignore_glob_case: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextSearchSummary {
    pub match_count: usize,
    pub limit_hit: bool,
    pub cancelled: bool,
}

/// Lines longer than this (UTF-16 units) are sent as a window around the match.
const PREVIEW_MAX_UNITS: usize = 1000;
const PREVIEW_CONTEXT_BYTES: usize = 250;
const DEFAULT_TEXT_RESULTS: usize = 500;

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn floor_char_boundary(text: &str, mut index: usize) -> usize {
    index = index.min(text.len());
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_char_boundary(text: &str, mut index: usize) -> usize {
    index = index.min(text.len());
    while !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

/// Converts a byte-offset match into editor (UTF-16) columns and trims huge lines.
fn to_text_match(result: sc_code_workspace::search::SearchResult) -> TextMatch {
    let line = result.line_text;
    let start = floor_char_boundary(&line, result.match_start);
    let end = ceil_char_boundary(&line, result.match_end.max(start));
    let column = utf16_len(&line[..start]);
    let match_length = utf16_len(&line[start..end]);

    let (line_content, preview_column) = if utf16_len(&line) <= PREVIEW_MAX_UNITS {
        (line, column)
    } else {
        // Only the reported preview is shortened; source columns stay exact.
        let from = floor_char_boundary(&line, start.saturating_sub(PREVIEW_CONTEXT_BYTES));
        let to = ceil_char_boundary(&line, end.saturating_add(PREVIEW_CONTEXT_BYTES));
        let preview_column = utf16_len(&line[from..start]);
        (line[from..to].to_string(), preview_column)
    };

    TextMatch {
        path: result.path.to_string_lossy().into_owned(),
        line_number: result.line_number,
        line_content,
        column,
        match_length,
        preview_column,
    }
}

fn text_query(
    query: String,
    options: Option<&SearchTextOptions>,
) -> (CrateSearchQuery, CrateSearchOptions) {
    let max_results = options
        .and_then(|o| o.max_results)
        .or(Some(DEFAULT_TEXT_RESULTS));
    (
        CrateSearchQuery {
            pattern: query,
            is_regex: options.and_then(|o| o.is_regex).unwrap_or(false),
            case_sensitive: options.and_then(|o| o.case_sensitive).unwrap_or(false),
            whole_word: options.and_then(|o| o.whole_word).unwrap_or(false),
            max_results,
        },
        CrateSearchOptions {
            include_patterns: options.and_then(|o| o.include.clone()).unwrap_or_default(),
            exclude_patterns: options.and_then(|o| o.exclude.clone()).unwrap_or_default(),
            max_results,
            max_file_size: options.and_then(|o| o.max_file_size),
            context_lines: None,
            disregard_ignore_files: options.and_then(|o| o.use_ignore_files) == Some(false),
            follow_symlinks: options.and_then(|o| o.follow_symlinks).unwrap_or(false),
            ignore_glob_case: options
                .and_then(|o| o.ignore_glob_case)
                .unwrap_or(cfg!(any(windows, target_os = "macos"))),
        },
    )
}

/// Cancellation flags of running streamed searches, keyed by the caller's request id.
fn running_searches() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Runs filesystem-heavy work off both the main thread and the async workers.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("search task failed: {e}"))?
}

#[tauri::command]
pub async fn search_files(
    root: String,
    pattern: String,
    options: Option<SearchFileOptions>,
) -> Result<Vec<FileMatch>, String> {
    blocking(move || {
        let crate_opts = options.map(|o| CrateFileSearchOptions {
            max_results: o.max_results,
            include_hidden: o.include_hidden,
            include: o.include,
            exclude: o.exclude,
        });
        let matches = crate_search_files(Path::new(&root), &pattern, crate_opts.as_ref());
        Ok(matches
            .into_iter()
            .map(|m| FileMatch {
                path: m.path,
                name: m.name,
                score: m.score,
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn search_text(
    root: String,
    query: String,
    options: Option<SearchTextOptions>,
) -> Result<Vec<TextMatch>, String> {
    blocking(move || {
        let (crate_query, crate_opts) = text_query(query, options.as_ref());
        let results =
            SearchEngine::search_with_options(Path::new(&root), &crate_query, &crate_opts)
                .map_err(|e| e.to_string())?;
        Ok(results.into_iter().map(to_text_match).collect())
    })
    .await
}

/// Streams matches per file over `on_file` until done, the result limit, or `search_cancel`.
#[tauri::command]
pub async fn search_text_stream(
    root: String,
    query: String,
    options: Option<SearchTextOptions>,
    request_id: u64,
    on_file: tauri::ipc::Channel<Vec<TextMatch>>,
) -> Result<TextSearchSummary, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    running_searches()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request_id, Arc::clone(&cancel));
    let flag = Arc::clone(&cancel);
    let outcome = blocking(move || {
        let (crate_query, crate_opts) = text_query(query, options.as_ref());
        let limit = crate_opts.max_results.unwrap_or(DEFAULT_TEXT_RESULTS);
        let count = SearchEngine::search_streaming(
            Path::new(&root),
            &crate_query,
            &crate_opts,
            &|matches| {
                let batch: Vec<TextMatch> = matches.iter().cloned().map(to_text_match).collect();
                if on_file.send(batch).is_err() {
                    // Webview gone (reload/close): nobody is listening any more.
                    flag.store(true, Ordering::Relaxed);
                }
            },
            &flag,
        )
        .map_err(|e| e.to_string())?;
        Ok((count, count >= limit))
    })
    .await;
    if let Ok(mut running) = running_searches().lock() {
        running.remove(&request_id);
    }
    let (match_count, limit_hit) = outcome?;
    Ok(TextSearchSummary {
        match_count,
        limit_hit,
        cancelled: cancel.load(Ordering::Relaxed),
    })
}

#[derive(Debug, Deserialize)]
pub struct WorkspaceFileSearchOptions {
    pub max_results: Option<usize>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub use_ignore_files: Option<bool>,
    pub follow_symlinks: Option<bool>,
    pub ignore_glob_case: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceFileSearchResult {
    pub paths: Vec<String>,
    pub limit_hit: bool,
}

/// Quick Open file search with VS Code semantics (dotfiles, `.gitignore`, relative globs,
/// fuzzy match on the relative path). Cancellable through `search_cancel(request_id)`.
#[tauri::command]
pub async fn search_workspace_files(
    root: String,
    pattern: String,
    options: Option<WorkspaceFileSearchOptions>,
    request_id: Option<u64>,
) -> Result<WorkspaceFileSearchResult, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(id) = request_id {
        running_searches()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, Arc::clone(&cancel));
    }
    let flag = Arc::clone(&cancel);
    let outcome = blocking(move || {
        let o = options.as_ref();
        let query = sc_code_workspace::search::WorkspaceFileQuery {
            include_patterns: o.and_then(|o| o.include.clone()).unwrap_or_default(),
            exclude_patterns: o.and_then(|o| o.exclude.clone()).unwrap_or_default(),
            max_results: o.and_then(|o| o.max_results),
            disregard_ignore_files: o.and_then(|o| o.use_ignore_files) == Some(false),
            follow_symlinks: o.and_then(|o| o.follow_symlinks).unwrap_or(false),
            ignore_glob_case: o
                .and_then(|o| o.ignore_glob_case)
                .unwrap_or(cfg!(any(windows, target_os = "macos"))),
        };
        let list =
            sc_code_workspace::search::search_workspace_files(Path::new(&root), &pattern, &query, &flag);
        Ok(WorkspaceFileSearchResult {
            paths: list.files.into_iter().map(|f| f.path).collect(),
            limit_hit: list.limit_hit,
        })
    })
    .await;
    if let (Some(id), Ok(mut running)) = (request_id, running_searches().lock()) {
        running.remove(&id);
    }
    outcome
}

#[tauri::command]
pub fn search_cancel(request_id: u64) {
    let flag = running_searches()
        .lock()
        .ok()
        .and_then(|running| running.get(&request_id).cloned());
    if let Some(flag) = flag {
        flag.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn result(line: &str, start: usize, end: usize) -> sc_code_workspace::search::SearchResult {
        sc_code_workspace::search::SearchResult {
            path: PathBuf::from("a.txt"),
            line_number: 1,
            line_text: line.to_string(),
            match_start: start,
            match_end: end,
        }
    }

    #[test]
    fn columns_are_utf16_units() {
        // "中文" is 6 UTF-8 bytes / 2 UTF-16 units; the emoji is 4 bytes / 2 units.
        let line = "中文\u{1F600} needle";
        let start = line.find("needle").unwrap();
        let m = to_text_match(result(line, start, start + 6));
        assert_eq!(m.column, 5);
        assert_eq!(m.match_length, 6);
        assert_eq!(m.preview_column, 5);
    }

    #[test]
    fn regex_match_length_is_the_actual_match() {
        let m = to_text_match(result("ab", 0, 2));
        assert_eq!(m.match_length, 2);
    }

    #[test]
    fn long_lines_are_windowed_around_the_match() {
        let line = format!("{}needle{}", "x".repeat(5000), "y".repeat(5000));
        let m = to_text_match(result(&line, 5000, 5006));
        assert_eq!(m.column, 5000);
        assert!(m.line_content.len() < 600);
        assert_eq!(&m.line_content[m.preview_column..m.preview_column + 6], "needle");
    }
}

// ---------------------------------------------------------------------------
// Commands backed directly by sc-code-workspace::SearchEngine (grouped / replace)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct WorkspaceSearchOptions {
    pub case_sensitive: Option<bool>,
    pub is_regex: Option<bool>,
    pub whole_word: Option<bool>,
    pub max_results: Option<usize>,
    pub max_file_size: Option<u64>,
    pub include_patterns: Option<Vec<String>>,
    pub exclude_patterns: Option<Vec<String>>,
    pub context_lines: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsSearchMatch {
    pub path: String,
    pub line_number: usize,
    pub line_text: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsContextLine {
    pub line_number: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsMatchWithContext {
    pub line_number: usize,
    pub line_text: String,
    pub match_start: usize,
    pub match_end: usize,
    pub before_context: Vec<WsContextLine>,
    pub after_context: Vec<WsContextLine>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsSearchGroup {
    pub file_path: String,
    pub matches: Vec<WsMatchWithContext>,
    pub line_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsReplacementEdit {
    pub line_number: usize,
    pub match_start: usize,
    pub match_end: usize,
    pub original: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsFileReplacement {
    pub path: String,
    pub edits: Vec<WsReplacementEdit>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WsReplaceReport {
    pub files_modified: u32,
    pub replacements_made: u32,
    pub errors: Vec<(String, String)>,
}

fn build_ws_query(query: &str, options: Option<&WorkspaceSearchOptions>) -> CrateSearchQuery {
    CrateSearchQuery {
        pattern: query.to_string(),
        is_regex: options.and_then(|o| o.is_regex).unwrap_or(false),
        case_sensitive: options.and_then(|o| o.case_sensitive).unwrap_or(false),
        whole_word: options.and_then(|o| o.whole_word).unwrap_or(false),
        max_results: options.and_then(|o| o.max_results),
    }
}

fn build_ws_options(options: Option<&WorkspaceSearchOptions>) -> CrateSearchOptions {
    CrateSearchOptions {
        include_patterns: options
            .and_then(|o| o.include_patterns.clone())
            .unwrap_or_default(),
        exclude_patterns: options
            .and_then(|o| o.exclude_patterns.clone())
            .unwrap_or_default(),
        max_results: options.and_then(|o| o.max_results),
        max_file_size: options.and_then(|o| o.max_file_size),
        context_lines: options.and_then(|o| o.context_lines),
        ..CrateSearchOptions::default()
    }
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn search_workspace(
    root: String,
    query: String,
    options: Option<WorkspaceSearchOptions>,
) -> Result<Vec<WsSearchMatch>, String> {
    let ws_query = build_ws_query(&query, options.as_ref());
    let ws_opts = build_ws_options(options.as_ref());

    let results = SearchEngine::search_with_options(Path::new(&root), &ws_query, &ws_opts)
        .map_err(|e| e.to_string())?;

    Ok(results
        .into_iter()
        .map(|r| WsSearchMatch {
            path: r.path.to_string_lossy().into_owned(),
            line_number: r.line_number,
            line_text: r.line_text,
            match_start: r.match_start,
            match_end: r.match_end,
        })
        .collect())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn search_workspace_grouped(
    root: String,
    query: String,
    options: Option<WorkspaceSearchOptions>,
) -> Result<Vec<WsSearchGroup>, String> {
    let ws_query = build_ws_query(&query, options.as_ref());
    let ws_opts = build_ws_options(options.as_ref());

    let groups = SearchEngine::search_grouped(Path::new(&root), &ws_query, &ws_opts)
        .map_err(|e| e.to_string())?;

    Ok(groups
        .into_iter()
        .map(|g| WsSearchGroup {
            file_path: g.file_path.to_string_lossy().into_owned(),
            line_count: g.line_count,
            matches: g
                .matches
                .into_iter()
                .map(|m| WsMatchWithContext {
                    line_number: m.line_number,
                    line_text: m.line_text,
                    match_start: m.match_start,
                    match_end: m.match_end,
                    before_context: m
                        .before_context
                        .into_iter()
                        .map(|c| WsContextLine {
                            line_number: c.line_number,
                            text: c.text,
                        })
                        .collect(),
                    after_context: m
                        .after_context
                        .into_iter()
                        .map(|c| WsContextLine {
                            line_number: c.line_number,
                            text: c.text,
                        })
                        .collect(),
                })
                .collect(),
        })
        .collect())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn search_workspace_replace_preview(
    root: String,
    query: String,
    replacement: String,
    options: Option<WorkspaceSearchOptions>,
) -> Result<Vec<WsFileReplacement>, String> {
    let ws_query = build_ws_query(&query, options.as_ref());

    let replacements = SearchEngine::replace_in_files(Path::new(&root), &ws_query, &replacement)
        .map_err(|e| e.to_string())?;

    Ok(replacements
        .into_iter()
        .map(|fr| WsFileReplacement {
            path: fr.path.to_string_lossy().into_owned(),
            edits: fr
                .edits
                .into_iter()
                .map(|e| WsReplacementEdit {
                    line_number: e.line_number,
                    match_start: e.match_start,
                    match_end: e.match_end,
                    original: e.original,
                    replacement: e.replacement,
                })
                .collect(),
        })
        .collect())
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn search_workspace_replace_apply(
    root: String,
    query: String,
    replacement: String,
) -> Result<WsReplaceReport, String> {
    let ws_query = CrateSearchQuery {
        pattern: query,
        is_regex: false,
        case_sensitive: true,
        whole_word: false,
        max_results: None,
    };

    let report =
        SearchEngine::replace_in_files_with_report(Path::new(&root), &ws_query, &replacement)
            .map_err(|e| e.to_string())?;

    Ok(WsReplaceReport {
        files_modified: report.files_modified,
        replacements_made: report.replacements_made,
        errors: report
            .errors
            .into_iter()
            .map(|(p, e)| (p.to_string_lossy().into_owned(), e))
            .collect(),
    })
}
