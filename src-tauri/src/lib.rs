mod backups;
mod icons;
mod nilesoft;
mod regfile;
mod registry;
mod winutil;

use std::path::Path;

use regfile::Hive;
use registry::{EntryInput, Location, LocationScan};
use tauri::Manager;

type R<T> = Result<T, String>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    elevated: bool,
    accent_color: Option<String>,
    backups_dir: String,
    /// Mica needs Windows 11 (build 22000+); older systems get a solid background.
    mica: bool,
}

/// Windows accent color from DWM (stored as ABGR) -> #RRGGBB.
fn accent_color() -> Option<String> {
    let key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\DWM")
        .ok()?;
    let abgr: u32 = key.get_value("AccentColor").ok()?;
    let (r, g, b) = (abgr & 0xFF, (abgr >> 8) & 0xFF, (abgr >> 16) & 0xFF);
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}

#[tauri::command]
fn system_info() -> SystemInfo {
    SystemInfo {
        elevated: winutil::is_elevated(),
        accent_color: accent_color(),
        backups_dir: backups::root_dir().to_string_lossy().to_string(),
        mica: windows_build() >= 22000,
    }
}

fn windows_build() -> u32 {
    winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .open_subkey(r"Software\Microsoft\Windows NT\CurrentVersion")
        .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
        .ok()
        .and_then(|b| b.parse().ok())
        .unwrap_or(0)
}

/// First candidate that exists (env vars expanded, bare names searched on PATH).
#[tauri::command(async)]
fn resolve_program(candidates: Vec<String>) -> Option<String> {
    candidates.iter().find_map(|c| icons::resolve_path(&winutil::expand_env(c)))
}

#[tauri::command]
fn list_locations() -> Vec<Location> {
    registry::locations()
}

#[tauri::command(async)]
fn scan_location(base: String) -> LocationScan {
    registry::scan(&base)
}

#[tauri::command(async)]
fn create_entry(hive: Hive, parent_shell: String, input: EntryInput, numbered: bool) -> R<String> {
    registry::create(hive, &parent_shell, &input, numbered)
}

#[tauri::command(async)]
fn update_entry(hive: Hive, key_path: String, input: EntryInput) -> R<()> {
    registry::update(hive, &key_path, &input)
}

#[tauri::command(async)]
fn delete_entry(hive: Hive, key_path: String) -> R<()> {
    registry::delete(hive, &key_path)
}

#[tauri::command(async)]
fn set_entry_enabled(hive: Hive, key_path: String, enabled: bool) -> R<()> {
    registry::set_enabled(hive, &key_path, enabled)
}

#[tauri::command(async)]
fn set_handler_blocked(clsid: String, blocked: bool) -> R<()> {
    registry::set_handler_blocked(&clsid, blocked)
}

#[tauri::command(async)]
fn export_entry(hive: Hive, key_path: String, dest: String) -> R<()> {
    match regfile::export_key(hive, &key_path, Path::new(&dest))? {
        true => Ok(()),
        false => Err("That entry no longer exists.".into()),
    }
}

#[tauri::command(async)]
fn import_reg(path: String) -> R<()> {
    regfile::import_file(Path::new(&path))
}

#[tauri::command(async)]
fn read_reg(path: String) -> R<String> {
    regfile::read_reg_text(Path::new(&path))
}

#[tauri::command(async)]
fn open_in_regedit(hive: Hive, key_path: String) -> R<()> {
    registry::open_in_regedit(hive, &key_path)
}

#[tauri::command(async)]
fn icon_for(spec: String) -> Option<String> {
    icons::icon_data_url(&spec)
}

#[tauri::command(async)]
fn icon_for_command(command: String) -> Option<String> {
    icons::exe_from_command(&command).and_then(|exe| icons::icon_data_url(&exe))
}

#[tauri::command(async)]
fn nilesoft_detect() -> Option<nilesoft::NilesoftInfo> {
    nilesoft::detect()
}

#[tauri::command(async)]
fn nilesoft_read(path: String) -> R<String> {
    nilesoft::read(&path)
}

#[tauri::command(async)]
fn nilesoft_write(path: String, content: String) -> R<()> {
    nilesoft::write(&path, &content)
}

#[tauri::command(async)]
fn nilesoft_restart() -> R<()> {
    nilesoft::restart()
}

#[tauri::command(async)]
fn list_backups() -> Vec<backups::Backup> {
    backups::list()
}

#[tauri::command(async)]
fn restore_backup(path: String, kind: String, name: String) -> R<()> {
    match kind.as_str() {
        "registry" => regfile::import_file(Path::new(&path)),
        "nilesoft" => nilesoft::restore(&path, &name),
        _ => Err("Unknown backup type.".into()),
    }
}

#[tauri::command(async)]
fn delete_backup(path: String) -> R<()> {
    backups::delete(&path)
}

#[tauri::command(async)]
fn open_path(path: String) -> R<()> {
    std::fs::create_dir_all(&path).ok();
    winutil::shell_open(&path, None, "open")
}

#[tauri::command(async)]
fn restart_explorer() -> R<()> {
    let _ = winutil::run_hidden("taskkill.exe", &["/f", "/im", "explorer.exe"]);
    std::process::Command::new("explorer.exe")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Tells DWM whether the window is dark so the Mica tint matches the UI theme.
/// Tauri's own setTheme doesn't reach the backdrop on undecorated windows.
#[tauri::command]
fn set_window_dark(window: tauri::WebviewWindow, dark: bool) -> R<()> {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let value: i32 = dark.into();
    unsafe {
        DwmSetWindowAttribute(
            windows::Win32::Foundation::HWND(hwnd.0),
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &value as *const _ as *const _,
            std::mem::size_of::<i32>() as u32,
        )
        .map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn restart_as_admin(app: tauri::AppHandle) -> R<()> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    winutil::shell_open(&exe.to_string_lossy(), None, "runas")?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::Mica)
                        .build(),
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            list_locations,
            scan_location,
            create_entry,
            update_entry,
            delete_entry,
            set_entry_enabled,
            set_handler_blocked,
            export_entry,
            import_reg,
            read_reg,
            open_in_regedit,
            icon_for,
            icon_for_command,
            resolve_program,
            nilesoft_detect,
            nilesoft_read,
            nilesoft_write,
            nilesoft_restart,
            list_backups,
            restore_backup,
            delete_backup,
            open_path,
            restart_explorer,
            restart_as_admin,
            set_window_dark,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
