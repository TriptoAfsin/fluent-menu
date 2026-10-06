//! Reads classic context menu entries (shell verbs + shellex handlers) from the
//! registry and turns edits into .reg text.

use serde::{Deserialize, Serialize};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::RegKey;

use crate::backups;
use crate::regfile::{self, Hive, RegWriter};
use crate::winutil;

const BLOCKED_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked";
const ECF_SEPARATOR_BEFORE: u32 = 0x20;
const ECF_SEPARATOR_AFTER: u32 = 0x40;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    /// Classes-relative base, e.g. `Directory\Background`. `{ext}` is replaced for file types.
    pub base: &'static str,
}

pub fn locations() -> Vec<Location> {
    vec![
        Location { id: "background", label: "Folder background", description: "Right-click on empty space inside a folder", base: r"Directory\Background" },
        Location { id: "desktop", label: "Desktop", description: "Right-click on the desktop", base: "DesktopBackground" },
        Location { id: "folder", label: "Folders", description: "Right-click on a folder", base: "Directory" },
        Location { id: "files", label: "All files", description: "Right-click on any file", base: "*" },
        Location { id: "filesystem", label: "Files and folders", description: "Right-click on any file or folder", base: "AllFilesystemObjects" },
        Location { id: "drive", label: "Drives", description: "Right-click on a drive", base: "Drive" },
        Location { id: "filetype", label: "File types", description: "Right-click on a specific file type", base: r"SystemFileAssociations\{ext}" },
    ]
}

fn root(hive: Hive) -> RegKey {
    RegKey::predef(match hive {
        Hive::HKCU => HKEY_CURRENT_USER,
        Hive::HKLM => HKEY_LOCAL_MACHINE,
    })
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Command,
    Submenu,
    Handler,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MenuEntry {
    pub hive: Hive,
    pub key_path: String,
    pub key_name: String,
    pub title: String,
    pub icon: Option<String>,
    pub command: Option<String>,
    pub kind: EntryKind,
    pub disabled: bool,
    pub extended: bool,
    pub position: Option<String>,
    pub separator_before: bool,
    pub separator_after: bool,
    pub children: Vec<MenuEntry>,
    /// True when children live elsewhere (ExtendedSubCommandsKey / CommandStore).
    pub external_children: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellHandler {
    pub hive: Hive,
    pub key_name: String,
    pub clsid: String,
    pub name: String,
    pub dll: Option<String>,
    pub blocked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationScan {
    pub entries: Vec<MenuEntry>,
    pub handlers: Vec<ShellHandler>,
}

pub fn base_path(base: &str) -> String {
    format!(r"Software\Classes\{base}")
}

fn read_string(key: &RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name).ok()
}

fn has_value(key: &RegKey, name: &str) -> bool {
    key.get_raw_value(name).is_ok()
}

fn read_entry(hive: Hive, key_path: &str, depth: u32) -> Option<MenuEntry> {
    let key = root(hive).open_subkey_with_flags(key_path, KEY_READ).ok()?;
    let key_name = key_path.rsplit('\\').next().unwrap_or_default().to_string();

    let raw_title = read_string(&key, "MUIVerb")
        .filter(|s| !s.is_empty())
        .or_else(|| read_string(&key, "").filter(|s| !s.is_empty()));
    let title = raw_title
        .map(|t| winutil::resolve_indirect(&t))
        .unwrap_or_else(|| key_name.clone())
        .replace('&', "");

    let command_key = key.open_subkey_with_flags("command", KEY_READ).ok();
    let command = command_key.as_ref().and_then(|c| read_string(c, "")).filter(|s| !s.is_empty());
    let delegate = command_key.as_ref().is_some_and(|c| has_value(c, "DelegateExecute"))
        || has_value(&key, "ExplorerCommandHandler");

    let sub_commands = read_string(&key, "SubCommands");
    let extended_sub = read_string(&key, "ExtendedSubCommandsKey");
    let is_submenu = sub_commands.is_some() || extended_sub.is_some();

    let mut children = Vec::new();
    let mut external_children = false;
    if is_submenu && depth < 4 {
        if let Some(ext) = &extended_sub {
            external_children = true;
            children = read_shell(hive, &format!(r"Software\Classes\{ext}\shell"), depth + 1);
        } else if sub_commands.as_deref().is_some_and(|s| !s.is_empty()) {
            external_children = true;
        } else {
            children = read_shell(hive, &format!(r"{key_path}\shell"), depth + 1);
        }
    }

    let flags = key.get_value::<u32, _>("CommandFlags").unwrap_or(0);
    Some(MenuEntry {
        hive,
        key_path: key_path.to_string(),
        key_name,
        title,
        icon: read_string(&key, "Icon").filter(|s| !s.is_empty()),
        command,
        kind: if is_submenu {
            EntryKind::Submenu
        } else if delegate {
            EntryKind::Handler
        } else {
            EntryKind::Command
        },
        disabled: has_value(&key, "LegacyDisable") || has_value(&key, "ProgrammaticAccessOnly"),
        extended: has_value(&key, "Extended"),
        position: read_string(&key, "Position").filter(|s| !s.is_empty()),
        separator_before: flags & ECF_SEPARATOR_BEFORE != 0,
        separator_after: flags & ECF_SEPARATOR_AFTER != 0,
        children,
        external_children,
    })
}

fn read_shell(hive: Hive, shell_path: &str, depth: u32) -> Vec<MenuEntry> {
    let Ok(shell) = root(hive).open_subkey_with_flags(shell_path, KEY_READ) else {
        return Vec::new();
    };
    let mut names: Vec<String> = shell.enum_keys().filter_map(Result::ok).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names
        .iter()
        .filter_map(|n| read_entry(hive, &format!(r"{shell_path}\{n}"), depth))
        .collect()
}

fn is_blocked(clsid: &str) -> bool {
    [Hive::HKLM, Hive::HKCU].iter().any(|&h| {
        root(h)
            .open_subkey_with_flags(BLOCKED_KEY, KEY_READ)
            .is_ok_and(|k| has_value(&k, clsid))
    })
}

fn read_handlers(hive: Hive, base: &str) -> Vec<ShellHandler> {
    let path = format!(r"{}\shellex\ContextMenuHandlers", base_path(base));
    let Ok(key) = root(hive).open_subkey_with_flags(&path, KEY_READ) else {
        return Vec::new();
    };
    let classes = RegKey::predef(winreg::enums::HKEY_CLASSES_ROOT);
    let mut out: Vec<ShellHandler> = key
        .enum_keys()
        .filter_map(Result::ok)
        .filter_map(|name| {
            let sub = key.open_subkey_with_flags(&name, KEY_READ).ok()?;
            let default = read_string(&sub, "").unwrap_or_default();
            let clsid = if default.starts_with('{') {
                default
            } else if name.starts_with('{') {
                name.clone()
            } else {
                return None;
            };
            let clsid_key = classes.open_subkey_with_flags(format!(r"CLSID\{clsid}"), KEY_READ).ok();
            let friendly = clsid_key.as_ref().and_then(|k| read_string(k, "")).filter(|s| !s.is_empty());
            let dll = clsid_key
                .as_ref()
                .and_then(|k| k.open_subkey_with_flags("InprocServer32", KEY_READ).ok())
                .and_then(|k| read_string(&k, ""));
            Some(ShellHandler {
                hive,
                name: friendly.unwrap_or_else(|| name.trim().to_string()),
                key_name: name,
                blocked: is_blocked(&clsid),
                clsid,
                dll,
            })
        })
        .collect();
    out.sort_by_key(|h| h.name.to_lowercase());
    out
}

pub fn scan(base: &str) -> LocationScan {
    let shell = format!(r"{}\shell", base_path(base));
    let mut entries = read_shell(Hive::HKCU, &shell, 0);
    entries.extend(read_shell(Hive::HKLM, &shell, 0));
    let mut handlers = read_handlers(Hive::HKCU, base);
    handlers.extend(read_handlers(Hive::HKLM, base));
    LocationScan { entries, handlers }
}

// ---------------------------------------------------------------- writes

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    pub title: String,
    pub icon: Option<String>,
    pub command: Option<String>,
    pub kind: EntryKind,
    #[serde(default)]
    pub extended: bool,
    pub position: Option<String>,
    #[serde(default)]
    pub separator_before: bool,
    #[serde(default)]
    pub separator_after: bool,
    #[serde(default)]
    pub children: Vec<EntryInput>,
}

/// Turns a title into a registry key name ("Open &Claude here" -> "Open Claude here").
pub fn key_name_for(title: &str) -> String {
    let cleaned: String = title
        .replace('&', "")
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | '"' | '*' | '?' | ':' | '<' | '>' | '|'))
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "fluent-menu item".into()
    } else {
        cleaned.to_string()
    }
}

fn unique_child(hive: Hive, parent: &str, wanted: &str) -> String {
    let parent_key = root(hive).open_subkey_with_flags(parent, KEY_READ).ok();
    let taken = |n: &str| parent_key.as_ref().is_some_and(|k| k.open_subkey(n).is_ok());
    if !taken(wanted) {
        return wanted.to_string();
    }
    (2..)
        .map(|i| format!("{wanted} {i}"))
        .find(|n| !taken(n))
        .unwrap()
}

fn write_values(w: &mut RegWriter, input: &EntryInput, existing: bool) {
    w.string("MUIVerb", &input.title);
    match input.icon.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(icon) => {
            w.string("Icon", icon);
        }
        None if existing => {
            w.delete_value("Icon");
        }
        None => {}
    }
    if input.extended {
        w.string("Extended", "");
    } else if existing {
        w.delete_value("Extended");
    }
    match input.position.as_deref().filter(|s| !s.is_empty()) {
        Some(p) => {
            w.string("Position", p);
        }
        None if existing => {
            w.delete_value("Position");
        }
        None => {}
    }
    let flags = if input.separator_before { ECF_SEPARATOR_BEFORE } else { 0 }
        | if input.separator_after { ECF_SEPARATOR_AFTER } else { 0 };
    if flags != 0 {
        w.dword("CommandFlags", flags);
    } else if existing {
        w.delete_value("CommandFlags");
    }
}

fn write_new(w: &mut RegWriter, hive: Hive, key_path: &str, input: &EntryInput) {
    w.key(hive, key_path);
    write_values(w, input, false);
    match input.kind {
        EntryKind::Submenu => {
            w.string("SubCommands", "");
            for (i, child) in input.children.iter().enumerate() {
                let name = format!("{:02}_{}", i + 1, key_name_for(&child.title));
                write_new(w, hive, &format!(r"{key_path}\shell\{name}"), child);
            }
        }
        _ => {
            if let Some(cmd) = input.command.as_deref().filter(|s| !s.is_empty()) {
                w.key(hive, &format!(r"{key_path}\command")).string("", cmd);
            }
        }
    }
}

/// `parent_shell` is the `...\shell` key the new entry goes under.
pub fn create(hive: Hive, parent_shell: &str, input: &EntryInput, numbered: bool) -> Result<String, String> {
    let mut name = key_name_for(&input.title);
    if numbered {
        let count = root(hive)
            .open_subkey_with_flags(parent_shell, KEY_READ)
            .map(|k| k.enum_keys().count())
            .unwrap_or(0);
        name = format!("{:02}_{}", count + 1, name);
    }
    let name = unique_child(hive, parent_shell, &name);
    let key_path = format!(r"{parent_shell}\{name}");
    let mut w = RegWriter::new();
    w.comment(&format!("fluent-menu: create \"{}\"", input.title));
    write_new(&mut w, hive, &key_path, input);
    regfile::apply(&w.text())?;
    Ok(key_path)
}

/// Rewrites the values fluent-menu manages, leaving any others (DelegateExecute etc.) intact.
pub fn update(hive: Hive, key_path: &str, input: &EntryInput) -> Result<(), String> {
    backups::snapshot_key(hive, key_path, "edit")?;
    let mut w = RegWriter::new();
    w.comment(&format!("fluent-menu: edit \"{}\"", input.title));
    w.key(hive, key_path);
    write_values(&mut w, input, true);
    if input.kind == EntryKind::Command {
        if let Some(cmd) = input.command.as_deref().filter(|s| !s.is_empty()) {
            w.key(hive, &format!(r"{key_path}\command")).string("", cmd);
        }
    }
    regfile::apply(&w.text())
}

pub fn delete(hive: Hive, key_path: &str) -> Result<(), String> {
    backups::snapshot_key(hive, key_path, "delete")?;
    let mut w = RegWriter::new();
    w.delete_key(hive, key_path);
    regfile::apply(&w.text())
}

pub fn set_enabled(hive: Hive, key_path: &str, enabled: bool) -> Result<(), String> {
    let mut w = RegWriter::new();
    w.key(hive, key_path);
    if enabled {
        w.delete_value("LegacyDisable").delete_value("ProgrammaticAccessOnly");
    } else {
        w.string("LegacyDisable", "");
    }
    regfile::apply(&w.text())
}

/// Blocking a shell extension is machine-wide, so it always goes to HKLM.
pub fn set_handler_blocked(clsid: &str, blocked: bool) -> Result<(), String> {
    let mut w = RegWriter::new();
    w.key(Hive::HKLM, BLOCKED_KEY);
    if blocked {
        w.string(clsid, "Blocked by fluent-menu");
    } else {
        w.delete_value(clsid);
    }
    // A per-user block would linger and keep it disabled, so clear that too.
    if !blocked {
        w.key(Hive::HKCU, BLOCKED_KEY).delete_value(clsid);
    }
    regfile::apply(&w.text())
}

pub fn open_in_regedit(hive: Hive, key_path: &str) -> Result<(), String> {
    let last = format!(r"Computer\{}\{}", hive.full_name(), key_path);
    let (applets, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Applets\Regedit")
        .map_err(|e| e.to_string())?;
    applets.set_value("LastKey", &last).map_err(|e| e.to_string())?;
    winutil::shell_open("regedit.exe", Some("-m"), "open")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_names_strip_accelerators_and_bad_chars() {
        assert_eq!(key_name_for("Open &Claude here"), "Open Claude here");
        assert_eq!(key_name_for("a/b:c"), "abc");
        assert_eq!(key_name_for("  "), "fluent-menu item");
    }

    #[test]
    fn new_submenu_writes_children_in_order() {
        let input = EntryInput {
            title: "Claude".into(),
            icon: Some(r"C:\claude.exe".into()),
            command: None,
            kind: EntryKind::Submenu,
            extended: false,
            position: None,
            separator_before: false,
            separator_after: false,
            children: vec![
                EntryInput {
                    title: "Open".into(),
                    icon: None,
                    command: Some("claude".into()),
                    kind: EntryKind::Command,
                    extended: false,
                    position: None,
                    separator_before: false,
                    separator_after: true,
                    children: vec![],
                },
            ],
        };
        let mut w = RegWriter::new();
        write_new(&mut w, Hive::HKCU, r"Software\Classes\Directory\shell\Claude", &input);
        let t = w.text();
        assert!(t.contains(r#""SubCommands"="""#));
        assert!(t.contains(r"[HKEY_CURRENT_USER\Software\Classes\Directory\shell\Claude\shell\01_Open\command]"));
        assert!(t.contains(r#""CommandFlags"=dword:00000040"#));
    }
}
