//! Opt-in lifecycle diagnostics. Never log runtime credentials or library data.
pub fn event(stage: &str) {
    #[cfg(not(target_os = "android"))]
    if let Some(path) = std::env::var_os("MREADER_SHUTDOWN_TRACE") {
        use std::io::Write;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let line = format!("{}\n", serde_json::json!({"timeMs":stamp,"pid":std::process::id(),"stage":stage}));
            let _ = file.write_all(line.as_bytes());
        }
    }
    #[cfg(target_os = "android")]
    let _ = stage;
}
