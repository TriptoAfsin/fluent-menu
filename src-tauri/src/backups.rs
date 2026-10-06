//! Automatic backups taken before every destructive change.
//! Registry backups are `reg export` snapshots; Nilesoft backups are file copies.
//! Layout: %APPDATA%\fluent-menu\backups\{registry,nilesoft}\<unix-ms>__<label>__<name>

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::regfile::{self, Hive};

pub fn root_dir() -> PathBuf {
    let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    base.join("fluent-menu").join("backups")
}

fn dir(kind: &str) -> Result<PathBuf, String> {
    let d = root_dir().join(kind);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn safe(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '.') { c } else { '_' })
        .collect()
}

/// Exports the key before it's changed. Missing keys are fine (nothing to back up).
pub fn snapshot_key(hive: Hive, key_path: &str, label: &str) -> Result<(), String> {
    let name = key_path.rsplit('\\').next().unwrap_or("key");
    let file = dir("registry")?.join(format!("{}__{}__{}.reg", now_ms(), label, safe(name)));
    regfile::export_key(hive, key_path, &file).map(|_| ())
}

/// `relative` is the path inside the Nilesoft install dir, e.g. `imports\terminal.nss`.
pub fn snapshot_file(source: &Path, relative: &str) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    let encoded = relative.replace(['\\', '/'], "--");
    let file = dir("nilesoft")?.join(format!("{}__save__{}", now_ms(), encoded));
    std::fs::copy(source, file).map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub path: String,
    pub kind: String,
    pub label: String,
    pub name: String,
    pub created_ms: u64,
    pub size: u64,
}

pub fn list() -> Vec<Backup> {
    let mut out = Vec::new();
    for kind in ["registry", "nilesoft"] {
        let Ok(entries) = std::fs::read_dir(root_dir().join(kind)) else { continue };
        for e in entries.flatten() {
            let file_name = e.file_name().to_string_lossy().to_string();
            let mut parts = file_name.splitn(3, "__");
            let (Some(ms), Some(label), Some(name)) = (parts.next(), parts.next(), parts.next()) else {
                continue;
            };
            out.push(Backup {
                path: e.path().to_string_lossy().to_string(),
                kind: kind.into(),
                label: label.into(),
                name: name.trim_end_matches(".reg").replace("--", "\\"),
                created_ms: ms.parse().unwrap_or(0),
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| b.created_ms.cmp(&a.created_ms));
    out
}

pub fn delete(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.starts_with(root_dir()) {
        return Err("Not a Fluent Menu backup.".into());
    }
    std::fs::remove_file(p).map_err(|e| e.to_string())
}
