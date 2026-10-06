# fluent-menu design

Date: 2026-10-06

## Goal

A modern Windows 11 app to create, edit, hide and remove Explorer context menu entries. It replaces hand-written `.reg` files and dated tools like ContextMenuManager. When Nilesoft Shell is installed, the app detects it and offers a visual editor for its config.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | All classic registry entries (shell verbs + shellex handlers), plus Nilesoft Shell |
| Nilesoft depth | Full visual editor, with lossless round trip of anything not modeled |
| Nilesoft visibility | Only shown when detected (uninstall key or known install folders containing `shell.dll` + `shell.nss`) |
| Stack | Tauri 2 + React + Fluent UI React v9, Mica backdrop |
| Distribution | GitHub Releases: NSIS per-user installer + portable exe, built by GitHub Actions on `v*` tags |

## Architecture

**Rust backend** (`src-tauri/src`)

- `registry.rs`: scans `Software\Classes\<location>\shell` in HKCU and HKLM, reads `shellex\ContextMenuHandlers`, and turns edits into `.reg` text. Hiding uses `LegacyDisable`. Blocking handlers uses `Shell Extensions\Blocked`.
- `regfile.rs`: `.reg` writer with escaping. Applies files with `reg.exe import`, elevated through `ShellExecuteEx runas` when HKLM is involved.
- `backups.rs`: `reg export` snapshots and Nilesoft file copies under `%APPDATA%\fluent-menu\backups`.
- `icons.rs`: `ExtractIconExW` turns icons into PNG data URLs, cached.
- `nilesoft.rs`: detection, file listing, guarded read and write (elevated copy into Program Files).
- `winutil.rs`: elevation check, hidden and elevated process launch, indirect strings.

**React UI** (`src`)

- The sidebar mirrors Windows Settings: menu locations, Templates, Nilesoft Shell (when detected), Backups, Settings.
- `nss/parser.ts` is a lossless NSS parser. Nodes keep their leading trivia and exact text. Only dirty nodes are regenerated. Unknown statements become raw nodes.
- `AdminProvider` runs before any change that needs elevation. It offers "Restart as administrator" or a one-off UAC prompt.

## Error handling

- Every write is preceded by a backup, and every failure shows a toast. Permission errors include a "Restart as administrator" action.
- Nilesoft writes only touch `.nss` files inside the detected install folder.

## Testing

- Vitest round-trips every bundled Nilesoft config fixture and covers the edit operations: insert, move, remove and prop edits.
- Rust unit tests cover `.reg` escaping, key naming, submenu generation and icon spec parsing.
