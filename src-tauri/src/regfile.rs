//! Builds .reg file text with correct escaping, and applies it with reg.exe.

use std::path::{Path, PathBuf};

use crate::winutil;

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
pub enum Hive {
    HKCU,
    HKLM,
}

impl Hive {
    pub fn full_name(self) -> &'static str {
        match self {
            Hive::HKCU => "HKEY_CURRENT_USER",
            Hive::HKLM => "HKEY_LOCAL_MACHINE",
        }
    }
}

pub fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[derive(Default)]
pub struct RegWriter {
    out: String,
}

impl RegWriter {
    pub fn new() -> Self {
        Self { out: "Windows Registry Editor Version 5.00\r\n".into() }
    }

    pub fn comment(&mut self, text: &str) -> &mut Self {
        self.out.push_str(&format!("\r\n; {text}"));
        self
    }

    pub fn key(&mut self, hive: Hive, path: &str) -> &mut Self {
        self.out.push_str(&format!("\r\n\r\n[{}\\{}]", hive.full_name(), path));
        self
    }

    pub fn delete_key(&mut self, hive: Hive, path: &str) -> &mut Self {
        self.out.push_str(&format!("\r\n\r\n[-{}\\{}]", hive.full_name(), path));
        self
    }

    fn name(name: &str) -> String {
        if name.is_empty() {
            "@".into()
        } else {
            format!("\"{}\"", escape(name))
        }
    }

    pub fn string(&mut self, name: &str, value: &str) -> &mut Self {
        self.out.push_str(&format!("\r\n{}=\"{}\"", Self::name(name), escape(value)));
        self
    }

    pub fn dword(&mut self, name: &str, value: u32) -> &mut Self {
        self.out.push_str(&format!("\r\n{}=dword:{:08x}", Self::name(name), value));
        self
    }

    pub fn delete_value(&mut self, name: &str) -> &mut Self {
        self.out.push_str(&format!("\r\n{}=-", Self::name(name)));
        self
    }

    pub fn text(&self) -> String {
        format!("{}\r\n", self.out)
    }
}

/// reg.exe reads UTF-16LE with BOM most reliably.
pub fn write_utf16(path: &Path, text: &str) -> std::io::Result<()> {
    let mut bytes = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    std::fs::write(path, bytes)
}

fn temp_reg_path() -> PathBuf {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    std::env::temp_dir().join(format!("fluent-menu-{ms}.reg"))
}

/// Imports .reg text. Elevates through UAC when the text touches machine-wide keys
/// and the app isn't already running as administrator.
pub fn apply(text: &str) -> Result<(), String> {
    let path = temp_reg_path();
    write_utf16(&path, text).map_err(|e| e.to_string())?;
    let result = import_file(&path);
    let _ = std::fs::remove_file(&path);
    result
}

pub fn needs_admin(text: &str) -> bool {
    let upper = text.to_uppercase();
    upper.contains("[HKEY_LOCAL_MACHINE")
        || upper.contains("[-HKEY_LOCAL_MACHINE")
        || upper.contains("HKEY_CLASSES_ROOT")
}

pub fn import_file(path: &Path) -> Result<(), String> {
    let text = read_reg_text(path)?;
    let p = path.to_string_lossy().to_string();
    if needs_admin(&text) && !winutil::is_elevated() {
        winutil::run_elevated("reg.exe", &format!("import \"{p}\""))
    } else {
        winutil::run_hidden("reg.exe", &["import", &p]).map(|_| ())
    }
}

/// Reads a .reg file that may be UTF-16LE (reg export default) or UTF-8/ANSI.
pub fn read_reg_text(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Ok(String::from_utf16_lossy(&units))
    } else {
        let start = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) { 3 } else { 0 };
        Ok(String::from_utf8_lossy(&bytes[start..]).into_owned())
    }
}

/// Exports a key with reg.exe. Returns Ok(false) if the key doesn't exist.
pub fn export_key(hive: Hive, path: &str, dest: &Path) -> Result<bool, String> {
    let key = format!("{}\\{}", hive.full_name(), path);
    let d = dest.to_string_lossy().to_string();
    match winutil::run_hidden("reg.exe", &["export", &key, &d, "/y"]) {
        Ok(_) => Ok(true),
        Err(e) if e.to_lowercase().contains("unable to find") => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_paths_and_quotes() {
        let mut w = RegWriter::new();
        w.key(Hive::HKCU, r"Software\Classes\Directory\shell\X\command")
            .string("", r#"wt.exe -d "%V\." "C:\a b\c.exe""#);
        let t = w.text();
        assert!(t.contains(r#"@="wt.exe -d \"%V\\.\" \"C:\\a b\\c.exe\"""#));
        assert!(t.contains(r"[HKEY_CURRENT_USER\Software\Classes\Directory\shell\X\command]"));
    }

    #[test]
    fn detects_admin_need() {
        assert!(needs_admin("[HKEY_LOCAL_MACHINE\\Software]"));
        assert!(!needs_admin("[HKEY_CURRENT_USER\\Software]"));
    }
}
