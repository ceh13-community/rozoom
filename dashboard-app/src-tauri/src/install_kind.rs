//! Which Linux package installed this binary (card Y1zBb4Xz).
//!
//! The updater plugin cannot replace a .deb or .rpm install without a privilege
//! prompt, and the app never asks for a password (PO decision 05/11/2026). On
//! Linux the frontend therefore only announces a new release and links to it.
//! The package kind selects the manifest key (`linux-x86_64-deb` /
//! `linux-x86_64-rpm`) and the wording of the notice.
//!
//! Detection is a file check, no process is spawned: dpkg records every installed
//! package as `/var/lib/dpkg/info/<name>.list`; an rpm host has the rpm database
//! directory. A binary run from an extracted package or a build tree is
//! `unknown`, and the notice then says "the new package".

use std::path::Path;

/// Package name the Tauri bundler derives from the product name, same for .deb and .rpm.
pub const PACKAGE_NAME: &str = "rozoom-k8s-linter-ide";

/// `None` off Linux; `Some("deb" | "rpm" | "unknown")` on Linux.
#[tauri::command]
pub fn linux_package_kind() -> Option<&'static str> {
    if cfg!(target_os = "linux") {
        Some(detect(
            Path::new("/var/lib/dpkg/info"),
            Path::new("/var/lib/rpm"),
        ))
    } else {
        None
    }
}

pub fn detect(dpkg_info_dir: &Path, rpm_db_dir: &Path) -> &'static str {
    if dpkg_info_dir.join(format!("{PACKAGE_NAME}.list")).is_file() {
        "deb"
    } else if rpm_db_dir.is_dir() {
        "rpm"
    } else {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::{detect, PACKAGE_NAME};
    use std::fs;
    use std::path::PathBuf;

    fn sandbox(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "rozoom-install-kind-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn dpkg_list_file_means_deb() {
        let root = sandbox("deb");
        let info = root.join("info");
        fs::create_dir_all(&info).unwrap();
        fs::write(info.join(format!("{PACKAGE_NAME}.list")), "/usr/bin/x\n").unwrap();
        assert_eq!(detect(&info, &root.join("rpm")), "deb");
    }

    #[test]
    fn dpkg_wins_over_an_rpm_database() {
        let root = sandbox("both");
        let info = root.join("info");
        let rpm = root.join("rpm");
        fs::create_dir_all(&info).unwrap();
        fs::create_dir_all(&rpm).unwrap();
        fs::write(info.join(format!("{PACKAGE_NAME}.list")), "").unwrap();
        assert_eq!(detect(&info, &rpm), "deb");
    }

    #[test]
    fn rpm_database_without_a_dpkg_entry_means_rpm() {
        let root = sandbox("rpm");
        let info = root.join("info");
        let rpm = root.join("rpm");
        fs::create_dir_all(&info).unwrap();
        fs::create_dir_all(&rpm).unwrap();
        assert_eq!(detect(&info, &rpm), "rpm");
    }

    #[test]
    fn another_packages_list_file_does_not_count() {
        let root = sandbox("other");
        let info = root.join("info");
        fs::create_dir_all(&info).unwrap();
        fs::write(info.join("rozoom-k8s-linter-ide-dbgsym.list"), "").unwrap();
        assert_eq!(detect(&info, &root.join("rpm")), "unknown");
    }

    #[test]
    fn neither_means_unknown() {
        let root = sandbox("none");
        assert_eq!(detect(&root.join("info"), &root.join("rpm")), "unknown");
    }
}
