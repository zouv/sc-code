use std::fs;
use std::path::Path;

fn main() {
    let ext_host_src = Path::new("extension-host");
    // OUT_DIR follows Cargo's actual target directory, including workspace/custom targets.
    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    let profile_dir = out_dir.ancestors().nth(3).expect("Cargo profile directory");
    let ext_host_dst = profile_dir.join("extension-host");
    fs::create_dir_all(&ext_host_dst).expect("create extension-host runtime directory");
    println!("cargo:rerun-if-changed={}", ext_host_src.display());
    // Clean only stale modules in the dedicated generated host directory.
    for entry in fs::read_dir(&ext_host_dst).expect("read generated host directory") {
        let entry = entry.expect("generated host entry");
        let name = entry.file_name();
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|ext| ext == "cjs")
            && (name.to_string_lossy().ends_with(".test.cjs") || !ext_host_src.join(&name).is_file()) {
            fs::remove_file(path).expect("remove stale generated host module");
        }
    }
    for entry in fs::read_dir(ext_host_src).expect("read extension-host sources") {
        let entry = entry.expect("extension-host entry");
        let src = entry.path();
        let name = entry.file_name();
        if src.extension().is_some_and(|ext| ext == "cjs")
            && !name.to_string_lossy().ends_with(".test.cjs") {
            let bytes = fs::read(&src).expect("read extension-host module");
            let dst = ext_host_dst.join(&name);
            if fs::read(&dst).map_or(true, |current| current != bytes) {
                fs::write(&dst, bytes).expect("copy extension-host module");
            }
            println!("cargo:rerun-if-changed={}", src.display());
        }
    }

    tauri_build::build();
}
