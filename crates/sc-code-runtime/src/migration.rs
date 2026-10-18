//! Copy-only migration. No overwrite, no symlink traversal, no source deletion.
use std::io::{self, Read, Write};
use std::path::Path;

pub fn reject_symlink_ancestors(path: &Path) -> io::Result<()> {
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "symlink path is not authorized"));
            }
            Ok(_) => {},
            Err(error) if error.kind() == io::ErrorKind::NotFound => {},
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// Stage next to the destination and publish without replacing any existing file.
pub fn copy_file_missing(source: &Path, destination: &Path) -> io::Result<bool> {
    reject_symlink_ancestors(source)?;
    reject_symlink_ancestors(destination)?;
    if destination.exists() { return Ok(false); }
    let parent = destination.parent().ok_or_else(|| io::Error::other("destination has no parent"))?;
    std::fs::create_dir_all(parent)?;
    let mut input = std::fs::File::open(source)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    if is_sqlite(source)? {
        backup_sqlite(source, staged.path())?;
    } else {
        io::copy(&mut input, &mut staged)?;
    }
    staged.as_file().set_permissions(input.metadata()?.permissions())?;
    staged.flush()?;
    staged.as_file().sync_all()?;
    match staged.persist_noclobber(destination) {
        Ok(_) => Ok(true),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error.error),
    }
}

/// A consistent SQLite snapshot includes WAL contents, never copies its live sidecars.
fn is_sqlite(path: &Path) -> io::Result<bool> {
    let mut header = [0_u8; 16];
    let mut input = std::fs::File::open(path)?;
    match input.read_exact(&mut header) {
        Ok(()) => Ok(&header == b"SQLite format 3\0"),
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(e) => Err(e),
    }
}
fn backup_sqlite(source: &Path, destination: &Path) -> io::Result<()> {
    use rusqlite::{backup::{Backup, StepResult}, Connection, OpenFlags};
    let input = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(io::Error::other)?;
    let mut output = Connection::open(destination).map_err(io::Error::other)?;
    {
        let backup = Backup::new(&input, &mut output).map_err(io::Error::other)?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            match backup.step(256).map_err(io::Error::other)? {
                StepResult::Done => break,
                _ if std::time::Instant::now() >= deadline => return Err(io::Error::new(io::ErrorKind::TimedOut, "SQLite migration snapshot timed out; source preserved")),
                _ => std::thread::sleep(std::time::Duration::from_millis(10)),
            }
        }
    }
    output.execute_batch("PRAGMA journal_mode=DELETE;").map_err(io::Error::other)?;
    let check: String = output.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(io::Error::other)?;
    if check != "ok" { return Err(io::Error::new(io::ErrorKind::InvalidData, check)); }
    output.close().map_err(|(_,e)| io::Error::other(e))?;
    Ok(())
}
fn is_sqlite_sidecar(path: &Path) -> io::Result<bool> {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    for suffix in ["-wal", "-shm", "-journal"] {
        if let Some(base) = name.strip_suffix(suffix) {
            let primary = path.with_file_name(base);
            reject_symlink_ancestors(&primary)?;
            return if primary.is_file() { is_sqlite(&primary) } else { Ok(false) };
        }
    }
    Ok(false)
}

pub fn copy_missing(source: &Path, destination: &Path, skip: Option<&Path>) -> io::Result<usize> {
    if source == destination || !source.exists() { return Ok(0); }
    reject_symlink_ancestors(source)?;
    reject_symlink_ancestors(destination)?;
    // A destination nested beneath the source would otherwise copy itself forever.
    if destination.starts_with(source) || source.starts_with(destination) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "migration roots must not overlap"));
    }
    std::fs::create_dir_all(destination)?;
    let mut count = 0;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let src = entry.path();
        let dst = destination.join(entry.file_name());
        let kind = entry.file_type()?;
        if skip == Some(src.as_path()) || kind.is_symlink() { continue; }
        // Existing links or file/directory collisions belong to the user: leave untouched.
        if let Ok(meta) = std::fs::symlink_metadata(&dst) {
            if meta.file_type().is_symlink() || meta.is_dir() != kind.is_dir() { continue; }
        }
        if kind.is_dir() { count += copy_missing(&src, &dst, skip)?; }
        else if kind.is_file() && !is_sqlite_sidecar(&src)? { count += usize::from(copy_file_missing(&src, &dst)?); }
    }
    Ok(count)
}

/// Per-source completion journal: completed sources are not re-imported after user deletion.
/// Close the old application before migration; SQLite uses online snapshots; other stores still require the old application to be closed.
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct MigrationReport {
    pub completed_sources: Vec<std::path::PathBuf>,
    pub copied_files: usize,
    pub failures: Vec<String>,
}
pub fn migrate_once(sources: &[std::path::PathBuf], destination: &Path) -> io::Result<MigrationReport> {
    reject_symlink_ancestors(destination)?;
    std::fs::create_dir_all(destination)?;
    let marker = destination.join(".sc-code-migration-v1.json");
    reject_symlink_ancestors(&marker)?;
    let mut report: MigrationReport = match std::fs::read(&marker) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => MigrationReport::default(),
        Err(e) => return Err(e),
    };
    report.failures.clear();
    for source in sources {
        if !source.is_dir() || source == destination { continue; }
        reject_symlink_ancestors(source)?;
        let source = source.canonicalize()?;
        if report.completed_sources.contains(&source) { continue; }
        // Never import another destination's journal as ordinary user data.
        // When renaming our own profile, carry successful history forward only
        // after the profile copy succeeds, so deleted settings are not resurrected.
        let source_marker = source.join(".sc-code-migration-v1.json");
        let renamed_profile = source.file_name().is_some_and(|n| n == "Sc-Code")
            && destination.file_name().is_some_and(|n| n == "ScCode")
            && source.parent().and_then(|p| p.canonicalize().ok()).is_some_and(|parent|
                destination.parent().and_then(|p| p.canonicalize().ok()).is_some_and(|p| p == parent));
        let previous = if renamed_profile && source_marker.exists() {
            reject_symlink_ancestors(&source_marker)?;
            Some(serde_json::from_slice::<MigrationReport>(&std::fs::read(&source_marker)?)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?)
        } else { None };
        match copy_missing(&source, destination, Some(&source_marker)) {
            Ok(count) => {
                report.copied_files += count;
                if let Some(previous) = previous {
                    for completed in previous.completed_sources {
                        if !report.completed_sources.contains(&completed) {
                            report.completed_sources.push(completed);
                        }
                    }
                }
                report.completed_sources.push(source);
            }
            Err(error) => report.failures.push(format!("{}: {error}", source.display())),
        }
        // Persist each successful source, so a failure later does not repeat earlier copies.
        let bytes = serde_json::to_vec_pretty(&report).map_err(io::Error::other)?;
        let mut staged = tempfile::NamedTempFile::new_in(destination)?;
        staged.write_all(&bytes)?; staged.as_file().sync_all()?;
        staged.persist(&marker).map_err(|e| e.error)?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renamed_profile_preserves_import_history_and_existing_target() {
        let tmp = tempfile::tempdir().unwrap();
        let upstream = tmp.path().join("SideX");
        let old = tmp.path().join("Sc-Code"); let new = tmp.path().join("ScCode");
        std::fs::create_dir_all(&upstream).unwrap();
        std::fs::write(upstream.join("deleted-setting"), "must not reappear").unwrap();
        migrate_once(&[upstream.clone()], &old).unwrap();
        std::fs::remove_file(old.join("deleted-setting")).unwrap();
        std::fs::write(old.join("setting"), "old profile").unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(new.join("setting"), "new profile").unwrap();
        let report = migrate_once(&[old.clone(), upstream.clone()], &new).unwrap();
        assert!(report.completed_sources.contains(&old.canonicalize().unwrap()));
        assert!(report.completed_sources.contains(&upstream.canonicalize().unwrap()));
        assert!(!new.join("deleted-setting").exists());
        assert_eq!(std::fs::read_to_string(new.join("setting")).unwrap(), "new profile");
        assert!(old.join("setting").exists());
        assert!(migrate_once(&[old, upstream], &new).unwrap().failures.is_empty());
    }
    #[test]
    fn unrelated_source_cannot_replace_destination_migration_journal() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("other"); let target = tmp.path().join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join(".sc-code-migration-v1.json"), "not a journal").unwrap();
        std::fs::write(source.join("config"), "data").unwrap();
        let report = migrate_once(&[source.clone()], &target).unwrap();
        assert_eq!(report.copied_files, 1);
        assert_eq!(report.completed_sources, vec![source.canonicalize().unwrap()]);
        assert!(source.join(".sc-code-migration-v1.json").exists());
    }
    #[test]
    fn merge_keeps_source_existing_target_and_binary_files() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("old"); let dst = tmp.path().join("new");
        std::fs::create_dir_all(src.join("User")).unwrap();
        std::fs::create_dir_all(dst.join("User")).unwrap();
        std::fs::write(src.join("User/settings.json"), "old").unwrap();
        std::fs::write(dst.join("User/settings.json"), "new").unwrap();
        std::fs::write(src.join("state.db"), [0, 255, 128]).unwrap();
        assert_eq!(copy_missing(&src, &dst, None).unwrap(), 1);
        assert_eq!(std::fs::read(dst.join("state.db")).unwrap(), [0, 255, 128]);
        assert_eq!(std::fs::read_to_string(dst.join("User/settings.json")).unwrap(), "new");
        assert!(src.join("state.db").exists());
        assert_eq!(copy_missing(&src, &dst, None).unwrap(), 0);
    }
    #[test]
    fn skip_and_overlapping_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("old"); let dst = tmp.path().join("new");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("skip"), "secret").unwrap();
        assert_eq!(copy_missing(&src, &dst, Some(&src.join("skip"))).unwrap(), 0);
        assert!(copy_missing(&src, &src.join("nested"), None).is_err());
    }
    #[test]
    fn completed_source_does_not_resurrect_deleted_target() {
        let tmp = tempfile::tempdir().unwrap(); let src = tmp.path().join("old"); let dst = tmp.path().join("new");
        std::fs::create_dir_all(&src).unwrap(); std::fs::write(src.join("deleted"), "legacy").unwrap();
        assert_eq!(migrate_once(&[src.clone()], &dst).unwrap().copied_files, 1);
        std::fs::remove_file(dst.join("deleted")).unwrap();
        assert_eq!(migrate_once(&[src.clone()], &dst).unwrap().completed_sources.len(), 1);
        assert!(!dst.join("deleted").exists()); assert!(src.join("deleted").exists());
        let second = tmp.path().join("second"); std::fs::create_dir_all(&second).unwrap();
        std::fs::write(second.join("extra"), "later").unwrap();
        assert_eq!(migrate_once(&[src, second], &dst).unwrap().completed_sources.len(), 2);
        assert!(dst.join("extra").exists());
    }
    #[test]
    fn corrupt_migration_marker_fails_closed() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join(".sc-code-migration-v1.json"), "broken").unwrap();
        assert!(migrate_once(&[], tmp.path()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn skips_links_and_rejects_target_link() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("old"); let dst = tmp.path().join("new");
        std::fs::create_dir_all(&src).unwrap();
        std::os::unix::fs::symlink(tmp.path(), src.join("escape")).unwrap();
        assert_eq!(copy_missing(&src, &dst, None).unwrap(), 0);
        let link = tmp.path().join("target-link");
        std::os::unix::fs::symlink(&dst, &link).unwrap();
        assert!(copy_missing(&src, &link, None).is_err());
    }

    #[test]
    fn sqlite_snapshot_includes_wal_and_does_not_copy_sidecars() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("old"); let dst = tmp.path().join("new");
        std::fs::create_dir_all(&src).unwrap();
        let db = rusqlite::Connection::open(src.join("state.db")).unwrap();
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('in-wal');").unwrap();
        assert!(src.join("state.db-wal").exists());
        assert_eq!(copy_missing(&src, &dst, None).unwrap(), 1);
        let imported = rusqlite::Connection::open(dst.join("state.db")).unwrap();
        assert_eq!(imported.query_row("SELECT value FROM records", [], |r| r.get::<_,String>(0)).unwrap(), "in-wal");
        assert!(!dst.join("state.db-wal").exists());
        assert!(!dst.join("state.db-shm").exists());
        assert!(src.join("state.db-wal").exists());
        drop(imported); drop(db);
    }
}
