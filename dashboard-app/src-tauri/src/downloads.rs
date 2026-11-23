//! Download and Export buttons save their file here.
//!
//! The fs plugin resolves its `$DOWNLOAD` scope once, when the app starts, and on
//! Linux only from XDG_DOWNLOAD_DIR in ~/.config/user-dirs.dirs. Without that entry
//! every export failed with "unknown path", and a folder configured after the start
//! still failed with "forbidden path". This command resolves the folder on each
//! save, falls back to ~/Downloads, creates it, and returns the absolute path so the
//! webview can say where the file is.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

const MAX_FILENAME_LEN: usize = 255;

/// A plain file name: no directory part, no hidden or parent entry, no control characters.
fn checked_filename(filename: &str) -> Result<&str, String> {
    let invalid = filename.is_empty()
        || filename.len() > MAX_FILENAME_LEN
        || filename.starts_with('.')
        || filename.contains(['/', '\\'])
        || filename.chars().any(char::is_control);
    if invalid {
        return Err(format!("not a plain file name: {filename:?}"));
    }
    Ok(filename)
}

/// The OS Downloads folder, or ~/Downloads when the OS names none.
fn downloads_folder(os_folder: Option<PathBuf>, home: Option<PathBuf>) -> Result<PathBuf, String> {
    os_folder
        .or_else(|| home.map(|home| home.join("Downloads")))
        .ok_or_else(|| "no Downloads folder and no home folder".to_string())
}

fn write_into(folder: &Path, filename: &str, contents: &str) -> Result<PathBuf, String> {
    let name = checked_filename(filename)?;
    fs::create_dir_all(folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
    let path = folder.join(name);
    fs::write(&path, contents).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path)
}

/// Writes `contents` to `filename` in the Downloads folder and returns the absolute path.
#[tauri::command]
pub fn save_download<R: Runtime>(
    app: AppHandle<R>,
    filename: String,
    contents: String,
) -> Result<String, String> {
    let paths = app.path();
    let folder = downloads_folder(paths.download_dir().ok(), paths.home_dir().ok())?;
    let path = write_into(&folder, &filename, &contents)?;
    log::info!("export saved to {}", path.display());
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_names_and_rejects_paths() {
        assert_eq!(checked_filename("pods.csv"), Ok("pods.csv"));
        assert_eq!(
            checked_filename("compliance-report-a1-1795468382447.json"),
            Ok("compliance-report-a1-1795468382447.json")
        );
        for bad in [
            "",
            ".bashrc",
            "../pods.csv",
            "a/b.csv",
            "a\\b.csv",
            "a\nb.csv",
            "..",
        ] {
            assert!(checked_filename(bad).is_err(), "{bad:?} must be rejected");
        }
        assert!(checked_filename(&"a".repeat(MAX_FILENAME_LEN + 1)).is_err());
    }

    #[test]
    fn prefers_the_os_folder_and_falls_back_to_home_downloads() {
        assert_eq!(
            downloads_folder(
                Some(PathBuf::from("/home/u/Завантаження")),
                Some(PathBuf::from("/home/u"))
            ),
            Ok(PathBuf::from("/home/u/Завантаження"))
        );
        assert_eq!(
            downloads_folder(None, Some(PathBuf::from("/home/u"))),
            Ok(PathBuf::from("/home/u/Downloads"))
        );
        assert!(downloads_folder(None, None).is_err());
    }

    #[test]
    fn creates_the_folder_and_writes_the_file() {
        let root =
            std::env::temp_dir().join(format!("rozoom-downloads-test-{}", std::process::id()));
        let folder = root.join("Downloads");
        let path = write_into(&folder, "pods.csv", "\u{feff}\"Name\"\n\"web\"").unwrap();
        assert_eq!(path, folder.join("pods.csv"));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "\u{feff}\"Name\"\n\"web\""
        );
        assert!(write_into(&folder, "../escape.csv", "x").is_err());
        assert!(!root.join("escape.csv").exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
