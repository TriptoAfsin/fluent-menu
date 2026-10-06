# fluent-menu

A Windows 11 style manager for the Explorer right-click menu. Create, edit, hide and remove context menu entries without touching `regedit`, and edit Nilesoft Shell menus visually.

![fluent-menu](app-icon.svg)

## Features

- **Every menu location.** Folder background, desktop, folders, all files, files and folders, drives, and individual file types (`.txt`, `.png`, ...).
- **Create entries and submenus.** Pick a title, icon and command. One click wraps a command so it opens in Windows Terminal at the folder you right-clicked.
- **Hide without deleting.** Turning an entry off uses Windows' own `LegacyDisable` flag, so turning it back on restores it exactly.
- **Shell extensions.** Turn COM context menu handlers (7-Zip, Git, etc.) on and off.
- **Templates.** Ready-made entries for programs found on your PC: Claude Code (normal and `--dangerously-skip-permissions`), Windows Terminal, VS Code, Cursor, PowerShell 7, Command Prompt and Git Bash.
- **Nilesoft Shell editor.** When [Nilesoft Shell](https://nilesoft.org) is installed, fluent-menu detects it and lets you edit `shell.nss` and its imports as a tree. You can add, edit, move and delete items, menus and separators. Anything it doesn't model visually (settings, `modify`, `remove`, variables) is kept byte for byte and can be edited as text. There's also a Source view.
- **Backups.** Every edit, delete and Nilesoft save is backed up first, and you can restore from the Backups page.
- **Import and export `.reg` files.**
- **Admin only when needed.** Entries for just you need no admin rights. Changing all-users entries prompts once, or you can restart as administrator.
- Native Windows 11 look: Mica, your accent color, light and dark themes.

## Install

Download from [Releases](https://github.com/TriptoAfsin/fluent-menu/releases/latest):

| File | What it is |
| --- | --- |
| `fluent-menu_<version>_x64-setup.exe` | Installer. Installs for the current user, adds a Start menu entry and an uninstaller. |
| `fluent-menu_<version>_x64-portable.exe` | Portable. A single exe you can run from anywhere. |

Both need the WebView2 runtime, which ships with Windows 11 and up-to-date Windows 10.

## How it works

- Registry changes are written as `.reg` text and applied with `reg.exe import`. Machine-wide changes (`HKLM`) run `reg.exe` elevated through UAC. Per-user entries go to `HKCU\Software\Classes`.
- Before an entry is edited or deleted, its key is exported to `%APPDATA%\fluent-menu\backups\registry`.
- Nilesoft files are parsed by a lossless parser (`src/nss/parser.ts`) that keeps the exact source text of every node, so saving an unchanged file writes back identical bytes. Saving into `Program Files` uses an elevated copy, and the previous version goes to `%APPDATA%\fluent-menu\backups\nilesoft`.

## Development

Requires Node 22+, pnpm 10, and the Rust stable toolchain (MSVC).

```sh
pnpm install
pnpm tauri dev       # run the app
pnpm test            # parser tests
cd src-tauri && cargo test
pnpm tauri build     # installer in src-tauri/target/release/bundle/nsis
```

## Releasing

Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then push a tag:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The Release workflow builds the installer and the portable exe and publishes them as a GitHub release.

## License

MIT
