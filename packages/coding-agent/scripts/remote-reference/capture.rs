// Test-only observational hook for Codex 0.153.4. No credentials or audio are
// written here: decoded messages cross a private Unix socket to the redactor.
// This file is not part of the native xcsh runtime.
use std::io::Write;
use std::os::unix::fs::MetadataExt;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;

static SOCKET: OnceLock<Option<String>> = OnceLock::new();
static SEQUENCE: Mutex<u64> = Mutex::new(0);

pub(crate) fn record(layer: &str, direction: &str, message: &serde_json::Value) {
    let Some(path) = SOCKET.get_or_init(|| std::env::var("XCSH_REFERENCE_CAPTURE_SOCKET").ok())
    else {
        return;
    };
    let Ok(mut sequence) = SEQUENCE.lock() else {
        return;
    };
    *sequence += 1;
    let result = (|| -> std::io::Result<()> {
        let parent = Path::new(path)
            .parent()
            .ok_or_else(|| std::io::Error::other("capture path"))?;
        let metadata = parent.symlink_metadata()?;
        let uid = std::fs::metadata("/proc/self")?.uid();
        if !metadata.is_dir() || metadata.mode() & 0o077 != 0 || metadata.uid() != uid {
            return Err(std::io::Error::other("capture directory"));
        }
        let metadata = std::fs::symlink_metadata(path)?;
        if metadata.mode() & 0o077 != 0 || metadata.uid() != uid {
            return Err(std::io::Error::other("capture socket"));
        }
        let mut payload = serde_json::to_vec(&serde_json::json!({
            "producer": env!("CARGO_PKG_NAME"), "sequence": *sequence,
            "layer": layer, "direction": direction, "message": message
        }))?;
        if payload.len() > 16 * 1024 * 1024 - 1 {
            return Err(std::io::Error::other("capture bounds"));
        }
        payload.push(b'\n');
        let mut stream = UnixStream::connect(path)?;
        stream.set_write_timeout(Some(Duration::from_millis(50)))?;
        stream.write_all(&payload)
    })();
    if result.is_err() {
        // Exclusive creation prevents overwriting anything. No raw data enters
        // this sentinel; its presence makes the comparison incomplete.
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(format!("{path}.incomplete"));
    }
}

pub(crate) fn json(layer: &str, direction: &str, text: &str) {
    if std::env::var_os("XCSH_REFERENCE_CAPTURE_SOCKET").is_none() {
        return;
    }
    match serde_json::from_str(text) {
        Ok(value) => record(layer, direction, &value),
        Err(_) => record(
            layer,
            direction,
            &serde_json::json!({"type": "malformed", "bytes": text.len()}),
        ),
    }
}
