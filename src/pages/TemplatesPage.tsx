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
  Option,
  Spinner,
} from "@fluentui/react-components";
import { Add20Regular, Edit20Regular } from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { api, shellPath, type EntryInput, type Hive, type Location } from "../api";
import { EntryEditor, type EditorMode } from "../components/EntryEditor";
import { EntryIcon, useAdmin, useNotify } from "../ui";

interface Template {
  id: string;
  name: string;
  description: string;
  candidates: string[];
  build: (exe: string) => EntryInput;
}

const inTerminal = (exe: string, args = "") => `wt.exe -d "%V\\." "${exe}"${args ? " " + args : ""}`;

const TEMPLATES: Template[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "A Claude submenu that opens Claude Code in Windows Terminal, normally or with --dangerously-skip-permissions.",
    candidates: ["%USERPROFILE%\\.local\\bin\\claude.exe", "claude.exe"],
    build: (exe) => ({
      title: "Claude",
      icon: exe,
      kind: "submenu",
      children: [
        { title: "Open Claude here", command: inTerminal(exe), icon: exe, kind: "command" },
        {
          title: "Open Claude here (skip permissions)",
          command: inTerminal(exe, "--dangerously-skip-permissions"),
          icon: exe,
          kind: "command",
        },
      ],
    }),
  },
  {
    id: "terminal",
    name: "Windows Terminal",
    description: "Open Windows Terminal at the folder you right-clicked.",
    candidates: ["%LOCALAPPDATA%\\Microsoft\\WindowsApps\\wt.exe", "wt.exe"],
    build: () => ({ title: "Open in Windows Terminal", command: 'wt.exe -d "%V\\."', icon: "imageres.dll,-5323", kind: "command" }),
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    description: "Open the folder in VS Code.",
    candidates: ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe", "%ProgramFiles%\\Microsoft VS Code\\Code.exe"],
    build: (exe) => ({ title: "Open with VS Code", command: `"${exe}" "%V"`, icon: exe, kind: "command" }),
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "Open the folder in Cursor.",
    candidates: ["%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe"],
    build: (exe) => ({ title: "Open with Cursor", command: `"${exe}" "%V"`, icon: exe, kind: "command" }),
  },
  {
    id: "pwsh",
    name: "PowerShell 7",
    description: "Open PowerShell 7 at the folder you right-clicked.",
    candidates: ["%ProgramFiles%\\PowerShell\\7\\pwsh.exe", "pwsh.exe"],
    build: (exe) => ({
      title: "PowerShell 7 here",
      command: `"${exe}" -NoExit -Command Set-Location -LiteralPath '%V'`,
      icon: exe,
      kind: "command",
    }),
  },
  {
    id: "cmd",
    name: "Command Prompt",
    description: "Open Command Prompt at the folder you right-clicked.",
    candidates: ["cmd.exe"],
    build: (exe) => ({ title: "Command Prompt here", command: `"${exe}" /s /k pushd "%V"`, icon: exe, kind: "command" }),
  },
  {
    id: "gitbash",
    name: "Git Bash",
    description: "Open Git Bash at the folder you right-clicked.",
    candidates: ["%ProgramFiles%\\Git\\git-bash.exe"],
    build: (exe) => ({ title: "Git Bash here", command: `"${exe}" "--cd=%V"`, icon: exe, kind: "command" }),
  },
];

const TARGETS = ["background", "folder", "desktop", "drive"];

export function TemplatesPage({ locations }: { locations: Location[] }) {
  const notify = useNotify();
  const admin = useAdmin();
  const [found, setFound] = useState<Record<string, string | null> | null>(null);
  const [applying, setApplying] = useState<{ t: Template; exe: string } | null>(null);
  const [targets, setTargets] = useState<string[]>(["background", "folder"]);
  const [hive, setHive] = useState<Hive>("HKCU");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorMode | null>(null);

  useEffect(() => {
    (async () => {
      const entries = await Promise.all(
        TEMPLATES.map(async (t) => [t.id, await api.resolveProgram(t.candidates).catch(() => null)] as const),
      );
      setFound(Object.fromEntries(entries));
    })();
  }, []);

  const byId = (id: string) => locations.find((l) => l.id === id);

  const apply = async () => {
    if (!applying) return;
    if (hive === "HKLM" && !(await admin.ask("Installing for all users writes machine-wide registry keys, which needs administrator permission."))) return;
    setBusy(true);
    const input = applying.t.build(applying.exe);
    try {
      for (const id of targets) {
        const loc = byId(id);
        if (loc) await api.createEntry(hive, shellPath(loc.base), input);
      }
      notify.success(`Added "${input.title}" to ${targets.length} location${targets.length === 1 ? "" : "s"}`);
      setApplying(null);
    } catch (e) {
      notify.error("Couldn't add the template", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-inner">
      <div className="page-header">
        <div className="grow">
          <h1>Templates</h1>
          <p>Ready-made entries for programs installed on this PC.</p>
        </div>
      </div>
      {!found && <Spinner label="Looking for installed programs..." />}
      {found && (
        <div className="template-grid">
          {TEMPLATES.map((t) => {
            const exe = found[t.id];
            return (
              <div className="template" key={t.id}>
                <header>
                  <EntryIcon icon={exe} size={32} />
                  {t.name}
                </header>
                <p>{t.description}</p>
                {exe ? (
                  <div className="row">
                    <Button appearance="primary" icon={<Add20Regular />} onClick={() => setApplying({ t, exe })}>
                      Add
                    </Button>
                    <Button
                      icon={<Edit20Regular />}
                      onClick={() =>
                        setEditor({
                          type: "create",
                          parentShell: shellPath(byId("background")!.base),
                          initial: t.build(exe),
                          heading: `Customize "${t.name}" (folder background)`,
                        })
                      }
                    >
                      Customize
                    </Button>
                  </div>
                ) : (
                  <span className="missing">Not installed</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!applying} onOpenChange={(_, d) => !d.open && setApplying(null)}>
        <DialogSurface style={{ maxWidth: 440 }}>
          <DialogBody>
            <DialogTitle>Add {applying?.t.name}</DialogTitle>
            <DialogContent>
              <div className="form">
                <Field label="Show it when right-clicking">
                  {TARGETS.map((id) => {
                    const loc = byId(id);
                    return (
                      loc && (
                        <Checkbox
                          key={id}
                          label={loc.label}
                          checked={targets.includes(id)}
                          onChange={(_, d) => setTargets((ts) => (d.checked ? [...ts, id] : ts.filter((x) => x !== id)))}
                        />
                      )
                    );
                  })}
                </Field>
                <Field label="Install for">
                  <Dropdown
                    value={hive === "HKCU" ? "Just me" : "All users (needs admin)"}
                    selectedOptions={[hive]}
                    onOptionSelect={(_, d) => setHive(d.optionValue as Hive)}
                  >
                    <Option value="HKCU">Just me</Option>
                    <Option value="HKLM">All users (needs admin)</Option>
                  </Dropdown>
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={!targets.length || busy} onClick={apply}>
                {busy ? <Spinner size="tiny" /> : "Add"}
              </Button>
              <Button onClick={() => setApplying(null)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <EntryEditor mode={editor} onClose={() => setEditor(null)} onSaved={() => {}} />
    </div>
  );
}
