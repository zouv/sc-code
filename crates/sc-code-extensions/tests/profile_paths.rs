use sc_code_extensions::paths::{
    global_storage_dir, sc_code_config_dir, user_data_dir, user_extensions_dir,
};
use std::{path::PathBuf, process::Command};

// Child process avoids mutating the parallel test runner's environment.
#[test]
fn isolated_profile_paths_child() {
    let Some(home) = std::env::var_os("SC_CODE_PATH_TEST_CHILD") else {
        return;
    };
    let home = PathBuf::from(home);
    assert_eq!(sc_code_config_dir(), home);
    assert_eq!(user_data_dir(), home.join("data"));
    assert_eq!(user_extensions_dir(), home.join("extensions"));
    assert_eq!(global_storage_dir(), home.join("data/User/globalStorage"));
}

#[test]
fn sc_code_home_isolates_all_extension_paths() {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("isolated-profile");
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "isolated_profile_paths_child", "--nocapture"])
        .env("SC_CODE_HOME", &home)
        .env("SC_CODE_PATH_TEST_CHILD", &home)
        .env("XDG_CONFIG_HOME", root.path().join("unrelated-config"))
        .env("XDG_DATA_HOME", root.path().join("unrelated-data"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(home.join("extensions").is_dir());
    assert!(!root.path().join("unrelated-config").exists());
    assert!(!root.path().join("unrelated-data").exists());
}
