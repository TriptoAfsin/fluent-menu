import { invoke } from "@tauri-apps/api/core";

export type Hive = "HKCU" | "HKLM";
export type EntryKind = "command" | "submenu" | "handler";

export interface Location {
  id: string;
  label: string;
  description: string;
  base: string;
}

export interface MenuEntry {
  hive: Hive;
  keyPath: string;
  keyName: string;
  title: string;
  icon: string | null;
  command: string | null;
  kind: EntryKind;
  disabled: boolean;
  extended: boolean;
  position: string | null;
  separatorBefore: boolean;
  separatorAfter: boolean;
  children: MenuEntry[];
  externalChildren: boolean;
}

export interface ShellHandler {
  hive: Hive;
  keyName: string;
  clsid: string;
  name: string;
  dll: string | null;
  blocked: boolean;
}

export interface LocationScan {
  entries: MenuEntry[];
  handlers: ShellHandler[];
}

export interface EntryInput {
  title: string;
  icon?: string | null;
  command?: string | null;
  kind: EntryKind;
  extended?: boolean;
  position?: string | null;
  separatorBefore?: boolean;
  separatorAfter?: boolean;
  children?: EntryInput[];
}

export interface SystemInfo {
  elevated: boolean;
  accentColor: string | null;
  backupsDir: string;
  mica: boolean;
}

export interface NssFile {
  name: string;
  path: string;
  size: number;
}

export interface NilesoftInfo {
  installDir: string;
  version: string | null;
  files: NssFile[];
  writable: boolean;
}

export interface Backup {
  path: string;
  kind: "registry" | "nilesoft";
  label: string;
  name: string;
  createdMs: number;
  size: number;
}

/** `Directory\Background` -> `Software\Classes\Directory\Background\shell` */
export const shellPath = (base: string) => `Software\\Classes\\${base}\\shell`;

export const api = {
  systemInfo: () => invoke<SystemInfo>("system_info"),
  listLocations: () => invoke<Location[]>("list_locations"),
  scanLocation: (base: string) => invoke<LocationScan>("scan_location", { base }),
  createEntry: (hive: Hive, parentShell: string, input: EntryInput, numbered = false) =>
    invoke<string>("create_entry", { hive, parentShell, input, numbered }),
  updateEntry: (hive: Hive, keyPath: string, input: EntryInput) =>
    invoke<void>("update_entry", { hive, keyPath, input }),
  deleteEntry: (hive: Hive, keyPath: string) => invoke<void>("delete_entry", { hive, keyPath }),
  setEntryEnabled: (hive: Hive, keyPath: string, enabled: boolean) =>
    invoke<void>("set_entry_enabled", { hive, keyPath, enabled }),
  setHandlerBlocked: (clsid: string, blocked: boolean) =>
    invoke<void>("set_handler_blocked", { clsid, blocked }),
  exportEntry: (hive: Hive, keyPath: string, dest: string) =>
    invoke<void>("export_entry", { hive, keyPath, dest }),
  importReg: (path: string) => invoke<void>("import_reg", { path }),
  readReg: (path: string) => invoke<string>("read_reg", { path }),
  openInRegedit: (hive: Hive, keyPath: string) => invoke<void>("open_in_regedit", { hive, keyPath }),
  iconFor: (spec: string) => invoke<string | null>("icon_for", { spec }),
  iconForCommand: (command: string) => invoke<string | null>("icon_for_command", { command }),
  resolveProgram: (candidates: string[]) => invoke<string | null>("resolve_program", { candidates }),
  nilesoftDetect: () => invoke<NilesoftInfo | null>("nilesoft_detect"),
  nilesoftRead: (path: string) => invoke<string>("nilesoft_read", { path }),
  nilesoftWrite: (path: string, content: string) => invoke<void>("nilesoft_write", { path, content }),
  nilesoftRestart: () => invoke<void>("nilesoft_restart"),
  listBackups: () => invoke<Backup[]>("list_backups"),
  restoreBackup: (b: Backup) =>
    invoke<void>("restore_backup", { path: b.path, kind: b.kind, name: b.name }),
  deleteBackup: (path: string) => invoke<void>("delete_backup", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  restartExplorer: () => invoke<void>("restart_explorer"),
  restartAsAdmin: () => invoke<void>("restart_as_admin"),
  setWindowDark: (dark: boolean) => invoke<void>("set_window_dark", { dark }),
};

export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
