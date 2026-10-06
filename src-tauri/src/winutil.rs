//! Thin wrappers over Win32 calls the rest of the backend needs:
//! elevation checks, running processes (hidden or elevated), indirect strings.

use std::os::windows::process::CommandExt;
use std::process::Command;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
};
use windows::Win32::UI::Shell::{
    SHLoadIndirectString, ShellExecuteExW, ShellExecuteW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
    SHELLEXECUTEINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNORMAL};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn is_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

/// Runs a program without a console window and returns its exit code + combined output.
pub fn run_hidden(program: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("failed to start {program}: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
    .trim()
    .to_string();
    if out.status.success() {
        Ok(text)
    } else {
        Err(if text.is_empty() { format!("{program} failed") } else { text })
    }
}

/// Runs a program elevated (UAC prompt), hidden, and waits for it to finish.
pub fn run_elevated(program: &str, params: &str) -> Result<(), String> {
    let file = wide(program);
    let params = wide(params);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info)
            .map_err(|_| "Administrator permission was denied or cancelled.".to_string())?;
        if info.hProcess.is_invalid() {
            return Ok(());
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 0u32;
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        if code == 0 {
            Ok(())
        } else {
            Err(format!("{program} exited with code {code}"))
        }
    }
}

/// Opens a file/program through the shell (handles programs that require elevation).
pub fn shell_open(file: &str, params: Option<&str>, verb: &str) -> Result<(), String> {
    let file = wide(file);
    let verb = wide(verb);
    let params = params.map(wide);
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            params.as_ref().map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr())),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute returns a value > 32 on success.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("Could not open the program.".into())
    }
}

/// Resolves "@shell32.dll,-1234" style resource strings. Returns the input when it isn't one.
pub fn resolve_indirect(s: &str) -> String {
    if !s.starts_with('@') {
        return s.to_string();
    }
    let src = wide(s);
    let mut buf = [0u16; 512];
    unsafe {
        if SHLoadIndirectString(PCWSTR(src.as_ptr()), &mut buf, None).is_ok() {
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            return String::from_utf16_lossy(&buf[..len]);
        }
    }
    s.to_string()
}

/// Expands %VAR% references using the current environment.
pub fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}
