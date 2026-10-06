//! Nilesoft Shell integration: detection and config file IO.
//! Parsing/editing of .nss happens in the UI; this side only reads and writes files safely.

use std::path::{Path, PathBuf};

use serde::Serialize;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::RegKey;

use crate::{backups, winutil};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NssFile {
    /// Relative to the install dir, e.g. `shell.nss`, `imports\terminal.nss`.
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NilesoftInfo {
    pub install_dir: String,
    pub version: Option<String>,
    pub files: Vec<NssFile>,
    pub writable: bool,
}

fn uninstall_entry() -> Option<(Option<String>, Option<String>)> {
    let roots = [
        (HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    for (hive, path) in roots {
        let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else { continue };
        for name in key.enum_keys().filter_map(Result::ok) {
            let Ok(app) = key.open_subkey_with_flags(&name, KEY_READ) else { continue };
            let display: String = app.get_value("DisplayName").unwrap_or_default();
            if display.to_lowercase().contains("nilesoft shell") {
                return Some((app.get_value("InstallLocation").ok(), app.get_value("DisplayVersion").ok()));
            }
        }
    }
    None
}

pub fn detect() -> Option<NilesoftInfo> {
    let (location, version) = uninstall_entry().unwrap_or((None, None));
    let mut candidates: Vec<PathBuf> = location.into_iter().filter(|s| !s.is_empty()).map(PathBuf::from).collect();
    for var in ["ProgramFiles", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            candidates.push(Path::new(&base).join("Nilesoft Shell"));
            candidates.push(Path::new(&base).join("Programs").join("Nilesoft Shell"));
        }
    }
    let dir = candidates
        .into_iter()
        .find(|d| d.join("shell.nss").is_file() && d.join("shell.dll").is_file())?;

    let mut files = Vec::new();
    collect(&dir, &dir, &mut files);
    files.sort_by(|a, b| {
        (a.name != "shell.nss", a.name.to_lowercase()).cmp(&(b.name != "shell.nss", b.name.to_lowercase()))
    });
    Some(NilesoftInfo {
        writable: winutil::is_elevated() || is_writable(&dir),
        install_dir: dir.to_string_lossy().to_string(),
        version,
        files,
    })
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<NssFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(root, &p, out);
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("nss")) {
            out.push(NssFile {
                name: p.strip_prefix(root).unwrap_or(&p).to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
}

fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".fluent-menu-probe");
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// Only files inside the detected install dir may be touched.
fn guard(path: &str) -> Result<(PathBuf, String), String> {
    let info = detect().ok_or("Nilesoft Shell is not installed.")?;
    let dir = PathBuf::from(&info.install_dir);
    let p = PathBuf::from(path);
    if !p.starts_with(&dir) || p.extension().is_none_or(|x| !x.eq_ignore_ascii_case("nss")) {
        return Err("That file is not part of the Nilesoft Shell config.".into());
    }
    let rel = p.strip_prefix(&dir).unwrap_or(&p).to_string_lossy().to_string();
    Ok((p, rel))
}

pub fn read(path: &str) -> Result<String, String> {
    let (p, _) = guard(path)?;
    // A UTF-8 BOM stays in the text (as U+FEFF) so saving writes it back unchanged.
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Backs up the current file, then writes. Falls back to an elevated copy when
/// the install dir is protected (Program Files).
pub fn write(path: &str, content: &str) -> Result<(), String> {
    let (p, rel) = guard(path)?;
    backups::snapshot_file(&p, &rel)?;
    write_raw(&p, content.as_bytes())
}

pub fn write_raw(p: &Path, bytes: &[u8]) -> Result<(), String> {
    match std::fs::write(p, bytes) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            let tmp = std::env::temp_dir().join(format!(
                "fluent-menu-{}.nss",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            ));
            std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
            let result = winutil::run_elevated(
                "cmd.exe",
                &format!("/c copy /y \"{}\" \"{}\"", tmp.display(), p.display()),
            );
            let _ = std::fs::remove_file(&tmp);
            result
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn restore(backup_path: &str, relative: &str) -> Result<(), String> {
    let info = detect().ok_or("Nilesoft Shell is not installed.")?;
    let target = Path::new(&info.install_dir).join(relative);
    let bytes = std::fs::read(backup_path).map_err(|e| e.to_string())?;
    backups::snapshot_file(&target, relative)?;
    write_raw(&target, &bytes)
}

/// `shell.exe -restart` reloads Nilesoft by restarting Explorer.
pub fn restart() -> Result<(), String> {
    let info = detect().ok_or("Nilesoft Shell is not installed.")?;
    let exe = Path::new(&info.install_dir).join("shell.exe");
    winutil::run_hidden(&exe.to_string_lossy(), &["-restart"]).map(|_| ())
}
