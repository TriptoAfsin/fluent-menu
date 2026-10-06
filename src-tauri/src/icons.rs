//! Turns registry icon specs ("C:\x.exe,0", "%SystemRoot%\shell32.dll,-12", "a.ico")
//! into PNG data URLs the UI can show.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

use crate::winutil::{expand_env, wide};

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// Splits `path,index` (index may be negative = resource id). Strips quotes.
pub fn parse_spec(spec: &str) -> (String, i32) {
    let s = spec.trim().trim_matches('"');
    if let Some((path, idx)) = s.rsplit_once(',') {
        if let Ok(i) = idx.trim().parse::<i32>() {
            return (path.trim().trim_matches('"').to_string(), i);
        }
    }
    (s.to_string(), 0)
}

/// Pulls the executable out of a command line: `"C:\a b\x.exe" --flag` -> `C:\a b\x.exe`.
pub fn exe_from_command(cmd: &str) -> Option<String> {
    let c = cmd.trim();
    let exe = if let Some(rest) = c.strip_prefix('"') {
        rest.split('"').next()?.to_string()
    } else {
        c.split_whitespace().next()?.to_string()
    };
    Some(exe)
}

pub fn icon_data_url(spec: &str) -> Option<String> {
    if spec.trim().is_empty() {
        return None;
    }
    let mut guard = CACHE.lock().ok()?;
    let cache = guard.get_or_insert_with(HashMap::new);
    if let Some(hit) = cache.get(spec) {
        return hit.clone();
    }
    let result = load(spec);
    cache.insert(spec.to_string(), result.clone());
    result
}

fn load(spec: &str) -> Option<String> {
    let (path, index) = parse_spec(spec);
    let path = expand_env(&path);
    let lower = path.to_lowercase();
    if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        let bytes = std::fs::read(&path).ok()?;
        let mime = if lower.ends_with(".png") { "png" } else { "jpeg" };
        return Some(format!(
            "data:image/{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    }
    let resolved = resolve_path(&path)?;
    let png = unsafe { extract_png(&resolved, index)? };
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

/// Bare names like `wt.exe` or `notepad.exe` are searched on PATH and in System32.
pub fn resolve_path(path: &str) -> Option<String> {
    if let Some(spec) = path.strip_prefix("appx:") {
        return resolve_appx(spec);
    }
    let p = std::path::Path::new(path);
    if p.is_absolute() {
        return p.exists().then(|| path.to_string());
    }
    let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default();
    if let Ok(root) = std::env::var("SystemRoot") {
        dirs.push(std::path::Path::new(&root).join("System32"));
        dirs.push(std::path::PathBuf::from(root));
    }
    // Bare names also match npm/bun shims (gemini.cmd, copilot.cmd, ...).
    let names: Vec<String> = if p.extension().is_some() {
        vec![path.to_string()]
    } else {
        vec![format!("{path}.exe"), format!("{path}.cmd"), path.to_string()]
    };
    dirs.iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|c| c.is_file())
        .map(|c| c.to_string_lossy().to_string())
}

/// `appx:Microsoft.WindowsTerminal\WindowsTerminal.exe` -> the file inside the installed
/// Store package. Execution aliases in WindowsApps (wt.exe) carry no icon, the real exe does.
fn resolve_appx(spec: &str) -> Option<String> {
    let (family, file) = spec.split_once('\\')?;
    let repo = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages")
        .ok()?;
    let prefix = format!("{}_", family.to_lowercase());
    let mut packages: Vec<String> = repo
        .enum_keys()
        .filter_map(Result::ok)
        .filter(|k| k.to_lowercase().starts_with(&prefix))
        .collect();
    packages.sort();
    packages.iter().rev().find_map(|name| {
        let root: String = repo.open_subkey(name).ok()?.get_value("PackageRootFolder").ok()?;
        let candidate = std::path::Path::new(&root).join(file);
        candidate.is_file().then(|| candidate.to_string_lossy().to_string())
    })
}

unsafe fn extract_png(path: &str, index: i32) -> Option<Vec<u8>> {
    let w = wide(path);
    let mut large = HICON::default();
    let count = ExtractIconExW(PCWSTR(w.as_ptr()), index, Some(&mut large), None, 1);
    if count == 0 || large.is_invalid() {
        return None;
    }
    let result = hicon_to_png(large);
    let _ = DestroyIcon(large);
    result
}

unsafe fn bitmap_bits(bitmap: HBITMAP, width: i32, height: i32) -> Option<Vec<u8>> {
    let dc = CreateCompatibleDC(None);
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut buf = vec![0u8; (width * height * 4) as usize];
    let lines = GetDIBits(
        dc,
        bitmap,
        0,
        height as u32,
        Some(buf.as_mut_ptr() as *mut _),
        &mut info,
        DIB_RGB_COLORS,
    );
    let _ = DeleteDC(dc);
    (lines != 0).then_some(buf)
}

unsafe fn hicon_to_png(icon: HICON) -> Option<Vec<u8>> {
    let mut info = ICONINFO::default();
    GetIconInfo(icon, &mut info).ok()?;
    let color = info.hbmColor;
    let mask = info.hbmMask;

    let result = (|| {
        if color.is_invalid() {
            return None;
        }
        let mut bm = BITMAP::default();
        if GetObjectW(color.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) == 0 {
            return None;
        }
        let (width, height) = (bm.bmWidth, bm.bmHeight);
        let mut pixels = bitmap_bits(color, width, height)?;

        // Old icons carry no alpha channel: derive it from the AND mask instead.
        if pixels.chunks_exact(4).all(|p| p[3] == 0) {
            if let Some(mask_bits) = bitmap_bits(mask, width, height) {
                for (px, m) in pixels.chunks_exact_mut(4).zip(mask_bits.chunks_exact(4)) {
                    px[3] = if m[0] == 0 { 255 } else { 0 };
                }
            }
        }
        for px in pixels.chunks_exact_mut(4) {
            px.swap(0, 2); // BGRA -> RGBA
        }

        let mut png_bytes = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut png_bytes, width as u32, height as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().ok()?;
            writer.write_image_data(&pixels).ok()?;
        }
        Some(png_bytes)
    })();

    if !color.is_invalid() {
        let _ = DeleteObject(color.into());
    }
    if !mask.is_invalid() {
        let _ = DeleteObject(mask.into());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_specs() {
        assert_eq!(parse_spec(r"C:\a.exe,0"), (r"C:\a.exe".into(), 0));
        assert_eq!(parse_spec(r"%SystemRoot%\shell32.dll,-12"), (r"%SystemRoot%\shell32.dll".into(), -12));
        assert_eq!(parse_spec(r#""C:\a b\x.exe""#), (r"C:\a b\x.exe".into(), 0));
    }

    #[test]
    fn exe_from_commands() {
        assert_eq!(exe_from_command(r#""C:\a b\x.exe" --y"#).unwrap(), r"C:\a b\x.exe");
        assert_eq!(exe_from_command(r#"wt.exe -d "%V""#).unwrap(), "wt.exe");
    }
}
