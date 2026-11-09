//! Owner-only permissions for the files that hold credentials (card bgdjUSAx,
//! reviewer finding 3 in GKFjp7g8).
//!
//! New files are created 0600 / 0700 from the webview (`$shared/lib/private-files`).
//! Files written by earlier releases kept the umask (664 / 775 on common desktops),
//! so `harden_private_files` runs once per launch and fixes them in place:
//! `<app data>/configs` (flattened kubeconfigs, pasted kubeconfig, Velero profiles)
//! and `<app data>/temp-connect-test` (connection-test copies). One level deep, no
//! symlink following. Not applicable on Windows, where the report is all zeros.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

pub const PRIVATE_DIRS: [&str; 4] = ["configs", "temp-connect-test", "tmp", "yaml-lint"];

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardenReport {
    pub dirs_fixed: u32,
    pub files_fixed: u32,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn harden_private_files<R: Runtime>(app: AppHandle<R>) -> Result<HardenReport, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data directory unavailable: {e}"))?;
    let mut report = HardenReport::default();
    // The app data root itself: 0700 closes every file written there without a mode,
    // past and future (gitops-apply-temp-*, yaml-restore-* left by a crash, ...). Only
    // this process's user ever needs anything under it.
    harden_root(&data_dir, &mut report);
    for name in PRIVATE_DIRS {
        harden_dir(&data_dir.join(name), &mut report);
    }
    if report.dirs_fixed > 0 || report.files_fixed > 0 || !report.errors.is_empty() {
        log::info!(
            "private files hardened: {} dirs, {} files, {} errors",
            report.dirs_fixed,
            report.files_fixed,
            report.errors.len()
        );
    }
    Ok(report)
}

/// 0700 on the directory itself, nothing inside it.
#[cfg(unix)]
pub fn harden_root(dir: &Path, report: &mut HardenReport) {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let Ok(meta) = fs::symlink_metadata(dir) else {
        return;
    };
    if !meta.is_dir() || meta.permissions().mode() & 0o777 == 0o700 {
        return;
    }
    match fs::set_permissions(dir, fs::Permissions::from_mode(0o700)) {
        Ok(()) => report.dirs_fixed += 1,
        Err(e) => report.errors.push(format!("{}: {e}", dir.display())),
    }
}

#[cfg(not(unix))]
pub fn harden_root(_dir: &Path, _report: &mut HardenReport) {}

#[cfg(unix)]
pub fn harden_dir(dir: &Path, report: &mut HardenReport) {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    const DIR_MODE: u32 = 0o700;
    const FILE_MODE: u32 = 0o600;

    let Ok(meta) = fs::symlink_metadata(dir) else {
        return; // nothing written yet
    };
    if !meta.is_dir() {
        return;
    }
    if meta.permissions().mode() & 0o777 != DIR_MODE {
        match fs::set_permissions(dir, fs::Permissions::from_mode(DIR_MODE)) {
            Ok(()) => report.dirs_fixed += 1,
            Err(e) => report.errors.push(format!("{}: {e}", dir.display())),
        }
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            report.errors.push(format!("{}: {e}", dir.display()));
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue; // symlinks and nested directories are not ours
        }
        if meta.permissions().mode() & 0o777 == FILE_MODE {
            continue;
        }
        match fs::set_permissions(&path, fs::Permissions::from_mode(FILE_MODE)) {
            Ok(()) => report.files_fixed += 1,
            Err(e) => report.errors.push(format!("{}: {e}", path.display())),
        }
    }
}

#[cfg(not(unix))]
pub fn harden_dir(_dir: &Path, _report: &mut HardenReport) {}

#[cfg(all(test, unix))]
mod tests {
    use super::{harden_dir, HardenReport};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    fn mode(path: &std::path::Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn fixes_group_and_world_readable_files_and_dir() {
        let root = std::env::temp_dir().join(format!("rozoom-harden-{}", std::process::id()));
        let dir = root.join("configs");
        fs::create_dir_all(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o775)).unwrap();
        let open = dir.join("a.yaml");
        let already = dir.join("b.yaml");
        fs::write(&open, "token: x").unwrap();
        fs::write(&already, "token: y").unwrap();
        fs::set_permissions(&open, fs::Permissions::from_mode(0o664)).unwrap();
        fs::set_permissions(&already, fs::Permissions::from_mode(0o600)).unwrap();

        let mut report = HardenReport::default();
        harden_dir(&dir, &mut report);

        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&open), 0o600);
        assert_eq!(mode(&already), 0o600);
        assert_eq!(
            report,
            HardenReport {
                dirs_fixed: 1,
                files_fixed: 1,
                errors: vec![]
            }
        );

        // Second pass changes nothing.
        let mut again = HardenReport::default();
        harden_dir(&dir, &mut again);
        assert_eq!(again, HardenReport::default());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn root_gets_0700_without_touching_its_files() {
        let root = std::env::temp_dir().join(format!("rozoom-harden-root-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o775)).unwrap();
        let loose = root.join("gitops-apply-temp-x.yaml");
        fs::write(&loose, "kind: Secret").unwrap();
        fs::set_permissions(&loose, fs::Permissions::from_mode(0o664)).unwrap();

        let mut report = HardenReport::default();
        super::harden_root(&root, &mut report);

        assert_eq!(mode(&root), 0o700);
        assert_eq!(mode(&loose), 0o664); // closed by the parent, not rewritten
        assert_eq!(
            report,
            HardenReport {
                dirs_fixed: 1,
                files_fixed: 0,
                errors: vec![]
            }
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn missing_dir_is_not_an_error() {
        let mut report = HardenReport::default();
        harden_dir(
            std::path::Path::new("/nonexistent/rozoom-harden-test"),
            &mut report,
        );
        assert_eq!(report, HardenReport::default());
    }
}
