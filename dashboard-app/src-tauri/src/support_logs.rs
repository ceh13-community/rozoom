//! "Something broke" support path (Sprint 19, spec update-2-crash-log-path.md).
//!
//! Two entry points into the same log directory that `tauri_plugin_log`
//! already writes to (`LogDir { file_name: "logs" }`, see main.rs):
//! - `read_recent_log_tail` feeds "Copy details for support" on the in-app
//!   error page; redaction of secrets happens on the webview side before the
//!   text reaches the clipboard.
//! - `open_logs_folder` opens the OS file manager on the folder. It is wired
//!   both to a Tauri command (Settings > Diagnostics) and to a native Help
//!   menu item, so it still works when the renderer is dead.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use tauri::menu::{Menu, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

pub const LOG_FILE_NAME: &str = "logs.log";
pub const MENU_OPEN_LOGS_FOLDER: &str = "help-open-logs-folder";

/// Upper bound on how much of the log we read back for the clipboard. The
/// active file can be up to 5 MB (see `max_file_size` in main.rs); the last
/// 256 KB is plenty for "what just happened" without blocking the UI.
const TAIL_READ_BYTES: u64 = 256 * 1024;
const MAX_TAIL_LINES: usize = 500;

fn log_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|e| format!("log directory unavailable: {e}"))
}

/// Last `max_lines` lines of the active log file, oldest first. An absent
/// file (fresh install, nothing logged yet) is not an error: returns "".
#[tauri::command]
pub fn read_recent_log_tail<R: Runtime>(
    app: AppHandle<R>,
    max_lines: Option<usize>,
) -> Result<String, String> {
    let path = log_dir(&app)?.join(LOG_FILE_NAME);
    let mut file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(format!("cannot open {}: {e}", path.display())),
    };
    let len = file
        .metadata()
        .map_err(|e| format!("cannot stat {}: {e}", path.display()))?
        .len();
    let start = len.saturating_sub(TAIL_READ_BYTES);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("cannot seek {}: {e}", path.display()))?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let text = String::from_utf8_lossy(&buf);
    Ok(tail_lines(
        &text,
        max_lines.unwrap_or(MAX_TAIL_LINES).min(MAX_TAIL_LINES),
    ))
}

fn tail_lines(text: &str, max_lines: usize) -> String {
    let mut lines: Vec<&str> = text.lines().collect();
    // Drop the first line when we started reading mid-file: it is a fragment.
    if text.len() as u64 >= TAIL_READ_BYTES && lines.len() > 1 {
        lines.remove(0);
    }
    let skip = lines.len().saturating_sub(max_lines);
    lines[skip..].join("\n")
}

fn open_logs_folder_inner<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let dir = log_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    log::info!("opening logs folder {}", dir.display());
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("cannot open {}: {e}", dir.display()))
}

/// Settings > Diagnostics > "Open Logs Folder".
#[tauri::command]
pub fn open_logs_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_logs_folder_inner(&app)
}

/// Returns the folder path for display next to the button.
#[tauri::command]
pub fn logs_folder_path<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    log_dir(&app).map(|p| p.to_string_lossy().into_owned())
}

/// Native Help > "Open Logs Folder". On macOS this extends the default menu
/// (Edit/Window shortcuts stay intact); elsewhere the app had no menu bar, so
/// only a Help menu appears.
pub fn install_help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open_logs =
        MenuItemBuilder::with_id(MENU_OPEN_LOGS_FOLDER, "Open Logs Folder").build(app)?;
    let help = SubmenuBuilder::new(app, "Help").item(&open_logs).build()?;

    #[cfg(target_os = "macos")]
    let menu = {
        let menu = Menu::default(app)?;
        menu.append(&help)?;
        menu
    };
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&help])?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == MENU_OPEN_LOGS_FOLDER {
        if let Err(e) = open_logs_folder_inner(app) {
            log::error!("Open Logs Folder failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::tail_lines;

    #[test]
    fn keeps_last_n_lines_oldest_first() {
        let text = "a\nb\nc\nd\n";
        assert_eq!(tail_lines(text, 2), "c\nd");
        assert_eq!(tail_lines(text, 10), "a\nb\nc\nd");
        assert_eq!(tail_lines("", 3), "");
    }
}
