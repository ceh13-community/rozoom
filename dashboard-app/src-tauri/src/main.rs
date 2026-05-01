// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_log;

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

fn is_loopback_url(raw_url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(raw_url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    is_loopback_host(host)
}

#[tauri::command]
fn relax_webview_tls(
    window_label: String,
    target_url: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !is_loopback_url(&target_url) {
        return Err(format!(
            "TLS relaxation refused: target URL {} is not a loopback address. \
             Only http(s)://localhost, 127.0.0.1, and ::1 are allowed.",
            target_url
        ));
    }
    let Some(webview) = app.get_webview_window(&window_label) else {
        return Err(format!("window {} not found", window_label));
    };
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::WebContextExt;
        use webkit2gtk::WebViewExt;
        webview
            .with_webview(|raw| {
                let webview: webkit2gtk::WebView = raw.inner();
                // Register a one-shot-per-host handler that explicitly accepts the failing
                // certificate only when the failing URI is loopback. Any non-loopback failing
                // URI falls through to the default error page - no global relaxation.
                WebViewExt::connect_load_failed_with_tls_errors(
                    &webview,
                    move |wv, failing_uri, cert, _errors| {
                        let Ok(parsed) = url::Url::parse(failing_uri) else {
                            return false;
                        };
                        let Some(host) = parsed.host_str() else {
                            return false;
                        };
                        if !is_loopback_host(host) {
                            return false;
                        }
                        if let Some(ctx) = WebViewExt::context(wv) {
                            WebContextExt::allow_tls_certificate_for_host(&ctx, cert, host);
                            WebViewExt::load_uri(wv, failing_uri);
                            return true;
                        }
                        false
                    },
                );
            })
            .map_err(|e| format!("with_webview failed: {}", e))?;
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = webview;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_loopback_host, is_loopback_url};

    #[test]
    fn loopback_host_accepts_standard_loopbacks() {
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("[::1]"));
        assert!(is_loopback_host("::1"));
    }

    #[test]
    fn loopback_host_rejects_public_and_private() {
        assert!(!is_loopback_host("example.com"));
        assert!(!is_loopback_host("evil.com"));
        assert!(!is_loopback_host("10.0.0.1"));
        assert!(!is_loopback_host("192.168.1.1"));
        assert!(!is_loopback_host("127.0.0.2"));
        assert!(!is_loopback_host(""));
    }

    #[test]
    fn loopback_url_parses_and_validates() {
        assert!(is_loopback_url("https://localhost:18080"));
        assert!(is_loopback_url("http://127.0.0.1:3000/path"));
        assert!(is_loopback_url("https://[::1]:443"));
    }

    #[test]
    fn loopback_url_rejects_public() {
        assert!(!is_loopback_url("https://evil.com/path"));
        assert!(!is_loopback_url("https://192.168.1.50"));
        assert!(!is_loopback_url("not a url"));
        assert!(!is_loopback_url(""));
        assert!(!is_loopback_url("file:///etc/passwd"));
    }

    #[test]
    fn loopback_url_rejects_host_spoofing_in_path() {
        // Host is the real host, not paths that look loopbacked.
        assert!(!is_loopback_url("https://evil.com/localhost"));
        assert!(!is_loopback_url("https://evil.com#@127.0.0.1"));
    }
}

fn main() {
    let start = std::time::Instant::now();
    tauri::Builder::default()
        .plugin(tauri_plugin_cache::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("logs".to_string()),
                    },
                ))
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .max_file_size(5000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![relax_webview_tls])
        .setup(move |_app| {
            log::info!("App setup took: {:?}", start.elapsed());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    log::info!("Total startup time: {:?}", start.elapsed());
}
