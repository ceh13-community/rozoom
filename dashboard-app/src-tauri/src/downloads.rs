//! Download and Export buttons save their file here.
//!
//! The fs plugin resolves its `$DOWNLOAD` scope once, when the app starts, and on
//! Linux only from XDG_DOWNLOAD_DIR in ~/.config/user-dirs.dirs. Without that entry
//! every export failed with "unknown path", and a folder configured after the start
//! still failed with "forbidden path". This command resolves the folder on each
//! save, falls back to ~/Downloads, creates it, and returns the absolute path so the
//! webview can say where the file is.
//!
//! The name comes from the webview and the content partly from the cluster (labels,
//! names), so the file is only ever created new, as one plain entry of that folder:
//! a name that is a path, a Windows device or stream, or a file (or symlink) that is
//! already there never leads the write anywhere else. An existing name gets " (1)",
//! " (2)" and so on, as browsers do.

use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

const MAX_FILENAME_LEN: usize = 255;
const MAX_NAME_ATTEMPTS: u32 = 1000;
/// Characters Windows does not allow in a file name; ':' would also open an NTFS stream.
const FORBIDDEN_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Device names Windows reserves, with or without an extension ("NUL.csv" is NUL).
/// COM0 and LPT0 count too, as current Windows documents them.
fn is_reserved_windows_name(filename: &str) -> bool {
    let stem = filename.split('.').next().unwrap_or("").trim_end();
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ((upper.starts_with("COM") || upper.starts_with("LPT"))
        && upper.len() == 4
        && upper.as_bytes()[3].is_ascii_digit())
}

/// A plain file name that is valid on every desktop OS: one path entry, not hidden,
/// no characters Windows forbids, no trailing dot or space, no reserved device name.
fn checked_filename(filename: &str) -> Result<&str, String> {
    let one_plain_component = {
        let mut components = Path::new(filename).components();
        matches!(
            (components.next(), components.next()),
            (Some(Component::Normal(name)), None) if name == OsStr::new(filename)
        )
    };
    let invalid = filename.is_empty()
        || filename.len() > MAX_FILENAME_LEN
        || filename.starts_with('.')
        || filename.ends_with('.')
        || filename.ends_with(' ')
        || filename.contains(FORBIDDEN_CHARS)
        || filename.chars().any(char::is_control)
        || is_reserved_windows_name(filename)
        || !one_plain_component;
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

/// "pods.csv", then "pods (1).csv", "pods (2).csv"...
fn numbered_name(filename: &str, attempt: u32) -> String {
    if attempt == 0 {
        return filename.to_string();
    }
    match filename.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({attempt}){}", &filename[..dot], &filename[dot..]),
        _ => format!("{filename} ({attempt})"),
    }
}

/// Creates the file new in `folder`. create_new is O_CREAT|O_EXCL: it fails on any existing
/// entry, a symlink included, without following it (POSIX open(2), and CREATE_NEW on Windows),
/// so a planted link cannot redirect the write; the next numbered name is tried instead.
fn write_into(folder: &Path, filename: &str, contents: &str) -> Result<PathBuf, String> {
    let name = checked_filename(filename)?;
    fs::create_dir_all(folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
    for attempt in 0..MAX_NAME_ATTEMPTS {
        let candidate = numbered_name(name, attempt);
        let path = folder.join(checked_filename(&candidate)?);
        if path.parent() != Some(folder) {
            return Err(format!(
                "{candidate:?} is not a file in {}",
                folder.display()
            ));
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(contents.as_bytes())
                    .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
                return Ok(path);
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("cannot write {}: {e}", path.display())),
        }
    }
    Err(format!(
        "{filename:?} and {MAX_NAME_ATTEMPTS} numbered names exist in {}",
        folder.display()
    ))
}

/// Writes `contents` to `filename` in the Downloads folder and returns the absolute path
/// of the file it created (a numbered name when `filename` was taken).
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

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "rozoom-downloads-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn accepts_plain_names_and_rejects_paths() {
        assert_eq!(checked_filename("pods.csv"), Ok("pods.csv"));
        assert_eq!(
            checked_filename("pods-minikube-2026-11-23T21-39-41-901Z.csv"),
            Ok("pods-minikube-2026-11-23T21-39-41-901Z.csv")
        );
        assert_eq!(checked_filename("pods (1).csv"), Ok("pods (1).csv"));
        assert_eq!(checked_filename("CONTEXT.md"), Ok("CONTEXT.md"));
        assert_eq!(checked_filename("COM10.txt"), Ok("COM10.txt"));
        for bad in [
            "",
            ".bashrc",
            "..",
            "../pods.csv",
            "a/b.csv",
            "a\\b.csv",
            "a\nb.csv",
            "latest-kube-bench-job:-x.json",
            "C:x.csv",
            "a<b.csv",
            "a|b.csv",
            "a?.csv",
            "a*.csv",
            "a\"b.csv",
            "pods.csv.",
            "pods.csv ",
            "NUL.csv",
            "nul",
            "CON",
            "aux.tar.gz",
            "COM1.json",
            "lpt9",
            "COM0.txt",
            "CONOUT$",
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
    fn numbers_a_taken_name_like_a_browser() {
        assert_eq!(numbered_name("pods.csv", 0), "pods.csv");
        assert_eq!(numbered_name("pods.csv", 1), "pods (1).csv");
        assert_eq!(numbered_name("report.tar.gz", 2), "report.tar (2).gz");
        assert_eq!(numbered_name("README", 3), "README (3)");
    }

    #[test]
    fn creates_the_folder_and_writes_the_file() {
        let root = temp_root("write");
        let folder = root.join("Downloads");
        let path = write_into(&folder, "pods.csv", "\u{feff}\"Name\"\n\"web\"").unwrap();
        assert_eq!(path, folder.join("pods.csv"));
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "\u{feff}\"Name\"\n\"web\""
        );
        assert!(write_into(&folder, "../escape.csv", "x").is_err());
        assert!(write_into(&folder, "C:escape.csv", "x").is_err());
        assert!(!root.join("escape.csv").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn never_overwrites_a_file_that_is_there() {
        let root = temp_root("taken");
        let folder = root.join("Downloads");
        let first = write_into(&folder, "pods.csv", "first").unwrap();
        let second = write_into(&folder, "pods.csv", "second").unwrap();
        let third = write_into(&folder, "pods.csv", "third").unwrap();
        assert_eq!(second, folder.join("pods (1).csv"));
        assert_eq!(third, folder.join("pods (2).csv"));
        assert_eq!(fs::read_to_string(&first).unwrap(), "first");
        assert_eq!(fs::read_to_string(&second).unwrap(), "second");
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_symlink_planted_under_the_name() {
        let root = temp_root("symlink");
        let folder = root.join("Downloads");
        fs::create_dir_all(&folder).unwrap();
        let target = root.join("bashrc");
        fs::write(&target, "original").unwrap();
        std::os::unix::fs::symlink(&target, folder.join("pods.csv")).unwrap();
        std::os::unix::fs::symlink(root.join("missing"), folder.join("pods (1).csv")).unwrap();

        let path = write_into(&folder, "pods.csv", "from the cluster").unwrap();

        assert_eq!(path, folder.join("pods (2).csv"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        assert!(!root.join("missing").exists());
        assert_eq!(fs::read_to_string(&path).unwrap(), "from the cluster");
        fs::remove_dir_all(&root).unwrap();
    }
}
