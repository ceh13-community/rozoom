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

#[cfg(not(target_os = "macos"))]
use tauri::menu::PredefinedMenuItem;
use tauri::menu::{Menu, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;

pub const LOG_FILE_NAME: &str = "logs.log";
pub const MENU_OPEN_LOGS_FOLDER: &str = "help-open-logs-folder";
pub const MENU_DOCUMENTATION: &str = "help-documentation";
pub const MENU_KEYBOARD_SHORTCUTS: &str = "help-keyboard-shortcuts";
pub const MENU_REPORT_ISSUE: &str = "help-report-issue";
pub const MENU_CHECK_FOR_UPDATES: &str = "help-check-for-updates";
pub const MENU_ABOUT_TEAM: &str = "help-about-team";

/// Event the webview listens to for the Help items it shows itself.
pub const HELP_MENU_EVENT: &str = "help-menu";
const DOCUMENTATION_URL: &str = "https://rozoom.app/docs";
const REPORT_ISSUE_URL: &str = "https://github.com/ceh13-community/rozoom/discussions";

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

/// Native Help menu on every OS. On macOS it extends the default menu (Edit/Window
/// shortcuts stay intact, About is in the app menu); elsewhere the app has no other menu,
/// so Help carries About too. Keyboard Shortcuts, Check for Updates and About the team are
/// shown by the webview, which listens for HELP_MENU_EVENT.
pub fn install_help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let documentation = MenuItemBuilder::with_id(MENU_DOCUMENTATION, "Documentation").build(app)?;
    let shortcuts =
        MenuItemBuilder::with_id(MENU_KEYBOARD_SHORTCUTS, "Keyboard Shortcuts").build(app)?;
    let report = MenuItemBuilder::with_id(MENU_REPORT_ISSUE, "Report an Issue").build(app)?;
    let about_team = MenuItemBuilder::with_id(MENU_ABOUT_TEAM, "About the team").build(app)?;
    let updates =
        MenuItemBuilder::with_id(MENU_CHECK_FOR_UPDATES, "Check for Updates").build(app)?;
    let open_logs =
        MenuItemBuilder::with_id(MENU_OPEN_LOGS_FOLDER, "Open Logs Folder").build(app)?;
    let builder = SubmenuBuilder::new(app, "Help")
        .item(&documentation)
        .item(&shortcuts)
        .item(&report)
        .separator()
        .item(&updates)
        .item(&open_logs)
        .separator()
        .item(&about_team);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.separator().item(&PredefinedMenuItem::about(
        app,
        Some("About ROZOOM"),
        Some(about_metadata(app)),
    )?);
    let help = builder.build()?;

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

/// Label prefix of the in-app preview windows (shared/api/in-app-browser.ts): pages of
/// port-forwards and links opened inside the app.
pub const IN_APP_WINDOW_PREFIX: &str = "inapp-";

/// Whether a window shows the app's Help menu. New windows inherit the app-wide menu on
/// Linux and Windows, so a port-forward page got a Help bar whose items act on the main
/// window, not on the page shown.
pub fn keeps_app_menu(label: &str) -> bool {
    !label.starts_with(IN_APP_WINDOW_PREFIX)
}

/// Page-load hook: drops the inherited Help menu from in-app preview windows. Runs on
/// every load; after the first one the window has no menu left and this does nothing.
pub fn drop_menu_from_preview<R: Runtime>(webview: &tauri::Webview<R>) {
    if keeps_app_menu(webview.label()) {
        return;
    }
    // macOS has one app-wide menu bar and nothing to remove per window.
    #[cfg(not(target_os = "macos"))]
    if let Err(e) = webview.window().remove_menu() {
        log::warn!("Menu not removed from {}: {e}", webview.label());
    }
}

#[cfg(not(target_os = "macos"))]
fn about_metadata<R: Runtime>(app: &AppHandle<R>) -> tauri::menu::AboutMetadata<'static> {
    tauri::menu::AboutMetadata {
        name: Some("ROZOOM - K8s Linter IDE".into()),
        version: Some(app.package_info().version.to_string()),
        website: Some("https://rozoom.app".into()),
        website_label: Some("rozoom.app".into()),
        license: Some("Apache-2.0".into()),
        // Without an icon GTK shows its "missing image" placeholder in the About dialog.
        icon: app
            .default_window_icon()
            .map(|icon| icon.clone().to_owned()),
        ..Default::default()
    }
}

/// What a Help item does: open a page, ask the webview to show something, or open logs.
#[derive(Debug, PartialEq, Eq)]
pub enum HelpAction {
    OpenUrl(&'static str),
    Webview(&'static str),
    OpenLogsFolder,
}

pub fn help_action(id: &str) -> Option<HelpAction> {
    match id {
        MENU_DOCUMENTATION => Some(HelpAction::OpenUrl(DOCUMENTATION_URL)),
        MENU_REPORT_ISSUE => Some(HelpAction::OpenUrl(REPORT_ISSUE_URL)),
        MENU_KEYBOARD_SHORTCUTS => Some(HelpAction::Webview("keyboard-shortcuts")),
        MENU_CHECK_FOR_UPDATES => Some(HelpAction::Webview("check-for-updates")),
        MENU_ABOUT_TEAM => Some(HelpAction::Webview("about-team")),
        MENU_OPEN_LOGS_FOLDER => Some(HelpAction::OpenLogsFolder),
        _ => None,
    }
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let Some(action) = help_action(event.id().as_ref()) else {
        return;
    };
    let result = match action {
        HelpAction::OpenUrl(url) => app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string()),
        HelpAction::Webview(what) => app.emit(HELP_MENU_EVENT, what).map_err(|e| e.to_string()),
        HelpAction::OpenLogsFolder => open_logs_folder_inner(app),
    };
    if let Err(e) = result {
        log::error!("Help menu {} failed: {e}", event.id().as_ref());
    }
}

#[cfg(test)]
mod tests {
    use super::{help_action, keeps_app_menu, tail_lines, HelpAction};

    #[test]
    fn every_help_item_has_an_action() {
        assert_eq!(
            help_action("help-documentation"),
            Some(HelpAction::OpenUrl("https://rozoom.app/docs"))
        );
        assert_eq!(
            help_action("help-report-issue"),
            Some(HelpAction::OpenUrl(
                "https://github.com/ceh13-community/rozoom/discussions"
            ))
        );
        assert_eq!(
            help_action("help-keyboard-shortcuts"),
            Some(HelpAction::Webview("keyboard-shortcuts"))
        );
        assert_eq!(
            help_action("help-check-for-updates"),
            Some(HelpAction::Webview("check-for-updates"))
        );
        assert_eq!(
            help_action("help-about-team"),
            Some(HelpAction::Webview("about-team"))
        );
        assert_eq!(
            help_action("help-open-logs-folder"),
            Some(HelpAction::OpenLogsFolder)
        );
        assert_eq!(help_action("something-else"), None);
    }

    #[test]
    fn only_the_main_windows_keep_the_help_menu() {
        assert!(keeps_app_menu("main"));
        assert!(!keeps_app_menu("inapp-1795283022620-k3x9qa"));
    }

    #[test]
    fn keeps_last_n_lines_oldest_first() {
        let text = "a\nb\nc\nd\n";
        assert_eq!(tail_lines(text, 2), "c\nd");
        assert_eq!(tail_lines(text, 10), "a\nb\nc\nd");
        assert_eq!(tail_lines("", 3), "");
    }
}
