// The app commands registered in main.rs `generate_handler!`. Listing them in
// the app manifest turns on the ACL for app commands: a command runs only in a
// window whose capability grants its `allow-<command>` permission. The main
// window gets them in capabilities/default.json and capabilities/slim.json;
// in-app browser windows (inapp-*) get none.
// A command added to generate_handler! must be added here and to both
// capability files, otherwise the main window gets "not allowed by ACL".
const APP_COMMANDS: &[&str] = &[
    "relax_webview_tls",
    "read_recent_log_tail",
    "open_logs_folder",
    "logs_folder_path",
    "harden_private_files",
    "linux_package_kind",
    "save_download",
];

fn main() {
    let target = std::env::var("TARGET").unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=TARGET_TRIPLE={}", target);
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
