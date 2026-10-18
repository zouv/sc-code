//! Bounded, workspace/session-scoped binary checkpoints with optimistic conflict protection.
//! This is an in-process journal, not a crash-persistent or multi-file atomic transaction.
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use crate::migration::reject_symlink_ancestors;

const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 100 * 1024 * 1024;
const MAX_ENTRIES: usize = 20;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("file operation failed: {0}")]
    Io(#[from] io::Error),
    #[error("checkpoint not found: {0}")]
    Missing(String),
    #[error("file changed outside this checkpoint; refusing rollback/edit: {0}")]
    Conflict(PathBuf),
    #[error("checkpoint size limit exceeded; edit refused rather than left unprotected")]
    SizeLimit,
    #[error("checkpoint scope/label must be non-empty and label unique within scope")]
    InvalidLabel,
}
type Image = Option<Vec<u8>>;
#[derive(Clone)]
struct Snapshot { before: Image, expected: Image }
struct Entry { scope: String, label: String, files: BTreeMap<PathBuf, Snapshot> }
#[derive(Default)]
pub struct Journal { entries: Vec<Entry> }

fn path_key(path: &Path) -> Result<PathBuf, Error> {
    let absolute = if path.is_absolute() { path.to_path_buf() } else { std::env::current_dir()?.join(path) };
    if absolute.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "parent traversal in checkpoint path").into());
    }
    reject_symlink_ancestors(&absolute)?;
    Ok(absolute)
}
fn image(path: &Path) -> Result<Image, Error> {
    reject_symlink_ancestors(path)?;
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !file.metadata()?.is_file() { return Err(io::Error::other("checkpoint target is not a regular file").into()); }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES { return Err(Error::SizeLimit); }
    Ok(Some(bytes))
}
/// Replace a single regular file using a staged sibling. Preserves permissions.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    reject_symlink_ancestors(path)?;
    let parent = path.parent().ok_or_else(|| io::Error::other("file has no parent"))?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    staged.write_all(bytes)?;
    if let Ok(meta) = std::fs::metadata(path) { staged.as_file().set_permissions(meta.permissions())?; }
    staged.as_file().sync_all()?;
    staged.persist(path).map_err(|error| Error::Io(error.error))?;
    Ok(())
}
impl Journal {
    pub fn create(&mut self, scope: &str, label: &str) -> Result<(), Error> {
        if scope.is_empty() || label.is_empty() || self.entries.iter().any(|e| e.scope == scope && e.label == label) {
            return Err(Error::InvalidLabel);
        }
        if self.entries.len() == MAX_ENTRIES { self.entries.remove(0); }
        self.entries.push(Entry { scope: scope.into(), label: label.into(), files: BTreeMap::new() });
        Ok(())
    }
    /// Must execute while holding the same lock as the subsequent write and record_after.
    pub fn track_before(&mut self, scope: &str, path: &Path) -> Result<(), Error> {
        self.prepare_write(scope, path, MAX_FILE_BYTES as usize)
    }
    fn prepare_write(&mut self, scope: &str, path: &Path, maximum_after: usize) -> Result<(), Error> {
        if scope != "legacy" && !self.entries.iter().any(|e| e.scope == scope) {
            return Err(Error::Missing(scope.into()));
        }
        let path = path_key(path)?;
        let current = image(&path)?;
        for entry in self.entries.iter().filter(|e| e.scope == scope) {
            if let Some(snapshot) = entry.files.get(&path) {
                if snapshot.expected != current { return Err(Error::Conflict(path)); }
            }
        }
        let affected = self.entries.iter().filter(|e| e.scope == scope).count();
        let needed = self.entries.iter().filter(|e| e.scope == scope && !e.files.contains_key(&path)).count();
        let used: usize = self.entries.iter().flat_map(|e| e.files.values()).map(|s| s.before.as_ref().map_or(0, Vec::len) + s.expected.as_ref().map_or(0, Vec::len)).sum();
        let replaced: usize = self.entries.iter().filter(|e| e.scope == scope)
            .filter_map(|e| e.files.get(&path)).map(|s| s.expected.as_ref().map_or(0, Vec::len)).sum();
        if used - replaced + needed * current.as_ref().map_or(0, Vec::len) + affected * maximum_after > MAX_TOTAL_BYTES {
            return Err(Error::SizeLimit);
        }
        for entry in self.entries.iter_mut().filter(|e| e.scope == scope) {
            entry.files.entry(path.clone()).or_insert_with(|| Snapshot { before: current.clone(), expected: current.clone() });
        }
        Ok(())
    }
    pub fn record_after(&mut self, scope: &str, path: &Path) -> Result<(), Error> {
        let path = path_key(path)?;
        let current = image(&path)?;
        for entry in self.entries.iter_mut().filter(|e| e.scope == scope) {
            if let Some(snapshot) = entry.files.get_mut(&path) { snapshot.expected.clone_from(&current); }
        }
        Ok(())
    }
    pub fn write(&mut self, scope: &str, path: &Path, bytes: &[u8]) -> Result<(), Error> {
        if bytes.len() as u64 > MAX_FILE_BYTES { return Err(Error::SizeLimit); }
        self.prepare_write(scope, path, bytes.len())?;
        atomic_write(path, bytes)?;
        self.record_after(scope, path)
    }
    pub fn rollback(&mut self, scope: &str, label: Option<&str>) -> Result<(String, usize), Error> {
        let index = self.entries.iter().rposition(|e| e.scope == scope && label.is_none_or(|label| e.label == label))
            .ok_or_else(|| Error::Missing(label.unwrap_or("latest").into()))?;
        let files = self.entries[index].files.clone();
        // Preflight ALL files: known external changes must not cause a partial rollback.
        for (path, snapshot) in &files {
            if image(path)? != snapshot.expected { return Err(Error::Conflict(path.clone())); }
        }
        for (path, snapshot) in &files {
            if image(path)? != snapshot.expected { return Err(Error::Conflict(path.clone())); }
            match &snapshot.before {
                Some(bytes) => atomic_write(path, bytes)?,
                None => match std::fs::remove_file(path) {
                    Ok(()) => {},
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {},
                    Err(error) => return Err(error.into()),
                },
            }
            // Retain retryable journal state if a later file write fails.
            for entry in self.entries.iter_mut().filter(|e| e.scope == scope) {
                if let Some(state) = entry.files.get_mut(path) { state.expected.clone_from(&snapshot.before); }
            }
        }
        let label = self.entries[index].label.clone();
        let mut position = 0;
        self.entries.retain(|e| { let keep = position < index || e.scope != scope; position += 1; keep });
        Ok((label, files.len()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn binary_restore_and_created_file_removal() {
        let tmp = tempfile::tempdir().unwrap(); let path = tmp.path().join("binary"); let new = tmp.path().join("new");
        std::fs::write(&path, [255, 0, 128]).unwrap();
        let mut journal = Journal::default(); journal.create("A", "turn1").unwrap();
        journal.write("A", &path, b"edited").unwrap(); journal.write("A", &new, b"new").unwrap();
        assert_eq!(journal.rollback("A", Some("turn1")).unwrap().1, 2);
        assert_eq!(std::fs::read(path).unwrap(), [255, 0, 128]); assert!(!new.exists());
    }
    #[test]
    fn external_change_blocks_all_restore_and_preserves_journal() {
        let tmp = tempfile::tempdir().unwrap(); let a = tmp.path().join("a"); let b = tmp.path().join("b");
        let mut journal = Journal::default(); journal.create("A", "t").unwrap();
        journal.write("A", &a, b"agent").unwrap(); journal.write("A", &b, b"agent").unwrap();
        std::fs::write(&b, b"user").unwrap();
        assert!(matches!(journal.rollback("A", Some("t")), Err(Error::Conflict(_))));
        assert_eq!(std::fs::read(&a).unwrap(), b"agent");
        std::fs::write(&b, b"agent").unwrap(); assert!(journal.rollback("A", Some("t")).is_ok());
    }
    #[test]
    fn older_turn_captures_files_first_edited_in_later_turn() {
        let tmp = tempfile::tempdir().unwrap(); let path = tmp.path().join("later");
        let mut journal = Journal::default(); journal.create("A", "one").unwrap(); journal.create("A", "two").unwrap();
        journal.write("A", &path, b"later").unwrap(); journal.rollback("A", Some("one")).unwrap(); assert!(!path.exists());
    }
    #[test]
    fn scopes_and_missing_checkpoints_are_isolated() {
        let tmp = tempfile::tempdir().unwrap(); let a = tmp.path().join("a"); let b = tmp.path().join("b");
        let mut journal = Journal::default(); journal.create("A", "same").unwrap(); journal.create("B", "same").unwrap();
        journal.write("A", &a, b"A").unwrap(); journal.write("B", &b, b"B").unwrap(); journal.rollback("A", None).unwrap();
        assert!(b.exists()); assert!(matches!(journal.rollback("A", None), Err(Error::Missing(_)))); journal.rollback("B", None).unwrap();
    }
    #[test]
    fn oversized_snapshot_never_becomes_created_file() {
        let tmp = tempfile::tempdir().unwrap(); let path = tmp.path().join("large");
        std::fs::write(&path, vec![0u8; MAX_FILE_BYTES as usize + 1]).unwrap();
        let mut journal = Journal::default(); journal.create("A", "t").unwrap();
        assert!(matches!(journal.write("A", &path, b"danger"), Err(Error::SizeLimit)));
        journal.rollback("A", None).unwrap(); assert_eq!(std::fs::metadata(path).unwrap().len(), MAX_FILE_BYTES+1);
    }
    #[test]
    fn nonlegacy_write_requires_live_checkpoint() {
        let tmp = tempfile::tempdir().unwrap(); let path = tmp.path().join("file");
        assert!(matches!(Journal::default().write("session", &path, b"x"), Err(Error::Missing(_))));
        assert!(!path.exists());
    }
    #[test]
    fn projected_postimages_are_bounded_before_write() {
        let tmp = tempfile::tempdir().unwrap(); let path = tmp.path().join("large");
        let mut journal = Journal::default();
        for i in 0..MAX_ENTRIES { journal.create("A", &format!("t{i}")).unwrap(); }
        journal.write("A", &path, &vec![0; MAX_FILE_BYTES as usize]).unwrap();
        let new_path = tmp.path().join("new");
        assert!(matches!(journal.write("A", &new_path, b"x"), Err(Error::SizeLimit)));
        assert!(!new_path.exists());
    }
    #[test]
    fn directory_and_duplicate_label_are_rejected() {
        let tmp = tempfile::tempdir().unwrap(); let mut journal = Journal::default(); journal.create("A", "t").unwrap();
        assert!(journal.create("A", "t").is_err()); assert!(journal.track_before("A", tmp.path()).is_err());
    }
}
