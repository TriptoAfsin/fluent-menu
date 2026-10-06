import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Tooltip,
} from "@fluentui/react-components";
import {
  Add16Regular,
  Delete16Regular,
  FolderOpen20Regular,
  WindowConsole20Regular,
  BracesVariable20Regular,
} from "@fluentui/react-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, type EntryInput, type EntryKind, type Hive, type MenuEntry } from "../api";
import { EntryIcon, useAdmin, useNotify } from "../ui";

export type EditorMode =
  | { type: "create"; parentShell: string; numbered?: boolean; hive?: Hive; allowScope?: boolean; initial?: EntryInput; heading?: string }
  | { type: "edit"; entry: MenuEntry };

interface ChildDraft {
  title: string;
  command: string;
  icon: string;
}

const VARIABLES = [
  { v: "%V", label: "%V  Folder or item path (works on backgrounds)" },
  { v: "%1", label: "%1  Selected file or folder" },
  { v: "%W", label: "%W  Working directory" },
];

export async function browseProgram(title = "Choose a program"): Promise<string | null> {
  const picked = await open({
    title,
    multiple: false,
    filters: [{ name: "Programs", extensions: ["exe", "cmd", "bat", "ps1"] }, { name: "All files", extensions: ["*"] }],
  });
  return typeof picked === "string" ? picked : null;
}

export async function browseIcon(): Promise<string | null> {
  const picked = await open({
    title: "Choose an icon",
    multiple: false,
    filters: [{ name: "Icons", extensions: ["ico", "exe", "dll", "png"] }, { name: "All files", extensions: ["*"] }],
  });
  return typeof picked === "string" ? picked : null;
}

/** Wraps a command so it runs in Windows Terminal at the clicked folder. */
export function wrapInTerminal(cmd: string): string {
  const trimmed = cmd.trim();
  if (/^"?wt(\.exe)?"?\s/i.test(trimmed)) return trimmed;
  return `wt.exe -d "%V\\." ${trimmed}`.trim();
}

export function EntryEditor({
  mode,
  onClose,
  onSaved,
}: {
  mode: EditorMode | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const admin = useAdmin();
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [command, setCommand] = useState("");
  const [kind, setKind] = useState<EntryKind>("command");
  const [extended, setExtended] = useState(false);
  const [position, setPosition] = useState("");
  const [sepBefore, setSepBefore] = useState(false);
  const [sepAfter, setSepAfter] = useState(false);
  const [hive, setHive] = useState<Hive>("HKCU");
  const [children, setChildren] = useState<ChildDraft[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mode) return;
    const src: EntryInput | MenuEntry = mode.type === "edit" ? mode.entry : (mode.initial ?? { title: "", kind: "command" });
    setTitle(src.title ?? "");
    setIcon(src.icon ?? "");
    setCommand(src.command ?? "");
    setKind(src.kind ?? "command");
    setExtended(!!src.extended);
    setPosition(src.position ?? "");
    setSepBefore(!!src.separatorBefore);
    setSepAfter(!!src.separatorAfter);
    setHive(mode.type === "edit" ? mode.entry.hive : (mode.hive ?? "HKCU"));
    setChildren(
      mode.type === "create"
        ? (mode.initial?.children ?? []).map((c) => ({ title: c.title, command: c.command ?? "", icon: c.icon ?? "" }))
        : [],
    );
  }, [mode]);

  if (!mode) return null;
  const isEdit = mode.type === "edit";
  const isHandler = kind === "handler";

  const input = (): EntryInput => ({
    title: title.trim(),
    icon: icon.trim() || null,
    command: kind === "command" ? command.trim() : null,
    kind,
    extended,
    position: position || null,
    separatorBefore: sepBefore,
    separatorAfter: sepAfter,
    children:
      kind === "submenu"
        ? children
            .filter((c) => c.title.trim())
            .map((c) => ({ title: c.title.trim(), command: c.command.trim(), icon: c.icon.trim() || icon.trim() || null, kind: "command" }))
        : [],
  });

  const valid = title.trim() && (kind !== "command" || command.trim() || isEdit);

  const save = async () => {
    if (hive === "HKLM" && !(await admin.ask("Entries for all users live in a machine-wide registry key, which needs administrator permission."))) return;
    setBusy(true);
    try {
      if (mode.type === "edit") {
        await api.updateEntry(mode.entry.hive, mode.entry.keyPath, input());
        notify.success(`Updated "${title}"`);
      } else {
        await api.createEntry(hive, mode.parentShell, input(), !!mode.numbered);
        notify.success(`Added "${title}"`);
      }
      onSaved();
      onClose();
    } catch (e) {
      notify.error("Couldn't save the entry", e);
    } finally {
      setBusy(false);
    }
  };

  const insertVar = (v: string) => setCommand((c) => (c ? `${c} "${v}"` : `"${v}"`));

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 640, width: "calc(100vw - 32px)" }}>
        <DialogBody>
          <DialogTitle>
            {mode.type === "edit" ? `Edit "${mode.entry.title}"` : (mode.heading ?? "New menu entry")}
          </DialogTitle>
          <DialogContent>
            <div className="form">
              {!isEdit && (
                <Field label="Type">
                  <RadioGroup layout="horizontal" value={kind} onChange={(_, d) => setKind(d.value as EntryKind)}>
                    <Radio value="command" label="Command" />
                    <Radio value="submenu" label="Submenu" />
                  </RadioGroup>
                </Field>
              )}

              <Field label="Title" hint="Put & before a letter to make it the keyboard shortcut, e.g. Open &Claude." required>
                <Input value={title} onChange={(_, d) => setTitle(d.value)} autoFocus placeholder="Open Claude here" />
              </Field>

              <div className="row">
                <Field label="Icon" className="grow" hint="An .exe, .dll or .ico file, optionally with ,index.">
                  <Input
                    value={icon}
                    onChange={(_, d) => setIcon(d.value)}
                    placeholder="C:\path\to\app.exe"
                    className="mono"
                    contentBefore={
                      <EntryIcon icon={icon || null} command={kind === "command" ? command : null} size={16} />
                    }
                  />
                </Field>
                <Tooltip content="Browse for an icon" relationship="label">
                  <Button icon={<FolderOpen20Regular />} onClick={async () => setIcon((await browseIcon()) ?? icon)} style={{ marginBottom: 22 }} />
                </Tooltip>
              </div>

              {kind === "command" && (
                <Field
                  label="Command"
                  hint={isHandler ? "This entry runs through a COM handler, so its command can't be edited here." : "Runs when the entry is clicked."}
                  required={!isEdit}
                >
                  <div className="row" style={{ alignItems: "center" }}>
                    <Input
                      className="grow mono"
                      value={command}
                      disabled={isHandler}
                      onChange={(_, d) => setCommand(d.value)}
                      placeholder={'wt.exe -d "%V\\." claude'}
                    />
                    <Tooltip content="Choose a program" relationship="label">
                      <Button
                        icon={<FolderOpen20Regular />}
                        disabled={isHandler}
                        onClick={async () => {
                          const p = await browseProgram();
                          if (p) setCommand(`"${p}" "%V"`);
                        }}
                      />
                    </Tooltip>
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <Tooltip content="Insert a variable" relationship="label">
                          <Button icon={<BracesVariable20Regular />} disabled={isHandler} />
                        </Tooltip>
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList>
                          {VARIABLES.map((v) => (
                            <MenuItem key={v.v} onClick={() => insertVar(v.v)}>
                              <span className="mono">{v.label}</span>
                            </MenuItem>
                          ))}
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                    <Tooltip content="Run in Windows Terminal at this folder" relationship="label">
                      <Button icon={<WindowConsole20Regular />} disabled={isHandler || !command.trim()} onClick={() => setCommand(wrapInTerminal(command))} />
                    </Tooltip>
                  </div>
                </Field>
              )}

              {kind === "submenu" && !isEdit && (
                <Field label="Submenu items" hint="Items are shown in this order. You can add more later.">
                  <div className="form" style={{ gap: 6 }}>
                    {children.map((c, i) => (
                      <div className="child-row" key={i}>
                        <Input
                          placeholder="Title"
                          value={c.title}
                          onChange={(_, d) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, title: d.value } : x)))}
                        />
                        <Input
                          className="mono"
                          placeholder="Command"
                          value={c.command}
                          onChange={(_, d) => setChildren((cs) => cs.map((x, j) => (j === i ? { ...x, command: d.value } : x)))}
                        />
                        <Button
                          appearance="subtle"
                          icon={<Delete16Regular />}
                          aria-label="Remove item"
                          onClick={() => setChildren((cs) => cs.filter((_, j) => j !== i))}
                        />
                      </div>
                    ))}
                    <div>
                      <Button icon={<Add16Regular />} onClick={() => setChildren((cs) => [...cs, { title: "", command: "", icon: "" }])}>
                        Add item
                      </Button>
                    </div>
                  </div>
                </Field>
              )}

              <Field label="Options">
                <div className="options-grid">
                  <Checkbox checked={extended} onChange={(_, d) => setExtended(!!d.checked)} label="Only show when Shift is held" />
                  <Checkbox checked={sepBefore} onChange={(_, d) => setSepBefore(!!d.checked)} label="Separator before" />
                  <div />
                  <Checkbox checked={sepAfter} onChange={(_, d) => setSepAfter(!!d.checked)} label="Separator after" />
                </div>
              </Field>

              <div className="row">
                <Field label="Position" className="grow">
                  <Dropdown
                    value={position || "Default"}
                    selectedOptions={[position]}
                    onOptionSelect={(_, d) => setPosition(d.optionValue ?? "")}
                  >
                    <Option value="">Default</Option>
                    <Option value="Top">Top</Option>
                    <Option value="Bottom">Bottom</Option>
                  </Dropdown>
                </Field>
                {mode.type === "create" && mode.allowScope !== false && (
                  <Field label="Install for" className="grow">
                    <Dropdown
                      value={hive === "HKCU" ? "Just me" : "All users (needs admin)"}
                      selectedOptions={[hive]}
                      onOptionSelect={(_, d) => setHive(d.optionValue as Hive)}
                    >
                      <Option value="HKCU">Just me</Option>
                      <Option value="HKLM">All users (needs admin)</Option>
                    </Dropdown>
                  </Field>
                )}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!valid || busy} onClick={save} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {isEdit ? "Save" : "Add"}
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
