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
  Option,
  Spinner,
  Switch,
} from "@fluentui/react-components";
import { Add20Regular, Edit20Regular, Search20Regular } from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";
import { api, shellPath, type EntryInput, type Hive, type Location } from "../api";
import { EntryEditor, type EditorMode } from "../components/EntryEditor";
import { EntryIcon, storageGet, storageSet, useAdmin, useNotify } from "../ui";

type Group = "AI coding agents" | "Editors" | "Terminals and shells" | "Git and file tools";
const GROUPS: Group[] = ["AI coding agents", "Editors", "Terminals and shells", "Git and file tools"];


interface Template {
  id: string;
  name: string;
  group: Group;
  description: string;
  /** First existing path wins. Env vars expand; bare names search PATH (.exe, .cmd). */
  candidates: string[];
  /** `icon` is the exe when it has an icon, else Windows Terminal's. */
  build: (exe: string, icon: string | null) => EntryInput;
}

/** Runs a console program in Windows Terminal at the right-clicked folder. */
const inTerminal = (exe: string, args = "") => `wt.exe -d "%V\\." "${exe}"${args ? " " + args : ""}`;

/** An AI CLI as a submenu: a normal launch plus its "no prompts" mode. */
const agentMenu = (title: string, exe: string, icon: string | null, unsafeLabel: string, unsafeArgs: string): EntryInput => ({
  title,
  icon,
  kind: "submenu",
  children: [
    { title: `Open ${title} here`, command: inTerminal(exe), icon, kind: "command" },
    { title: `Open ${title} here (${unsafeLabel})`, command: inTerminal(exe, unsafeArgs), icon, kind: "command" },
  ],
});

const openFolder = (title: string) => (exe: string, icon: string | null): EntryInput => ({
  title,
  command: `"${exe}" "%V"`,
  icon,
  kind: "command",
});

const TEMPLATES: Template[] = [
  // ---------------------------------------------------------------- AI coding agents
  {
    id: "claude",
    name: "Claude Code",
    group: "AI coding agents",
    description: "Claude submenu: open Claude Code in Windows Terminal, normally or with --dangerously-skip-permissions.",
    candidates: ["%USERPROFILE%\\.local\\bin\\claude.exe", "claude"],
    build: (exe, icon) => agentMenu("Claude", exe, icon, "skip permissions", "--dangerously-skip-permissions"),
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    group: "AI coding agents",
    description: "Codex submenu: open Codex CLI here, normally or with --dangerously-bypass-approvals-and-sandbox.",
    candidates: ["%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin\\codex.exe", "codex"],
    build: (exe, icon) =>
      agentMenu("Codex", exe, icon, "bypass approvals", "--dangerously-bypass-approvals-and-sandbox"),
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    group: "AI coding agents",
    description: "Gemini submenu: open Gemini CLI here, normally or with --approval-mode yolo.",
    candidates: ["gemini"],
    build: (exe, icon) => agentMenu("Gemini", exe, icon, "YOLO", "--approval-mode yolo"),
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    group: "AI coding agents",
    description: "Copilot submenu: open Copilot CLI here, normally or with --allow-all (all tools, paths and URLs).",
    candidates: ["%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\copilot.exe", "copilot"],
    build: (exe, icon) => agentMenu("Copilot", exe, icon, "allow all", "--allow-all"),
  },
  {
    id: "opencode",
    name: "opencode",
    group: "AI coding agents",
    description: "Open the opencode TUI in Windows Terminal at the folder you right-clicked.",
    candidates: ["%USERPROFILE%\\.bun\\bin\\opencode.exe", "opencode"],
    build: (exe, icon) => ({ title: "Open opencode here", command: inTerminal(exe), icon: icon, kind: "command" }),
  },

  // ---------------------------------------------------------------- editors
  {
    id: "vscode",
    name: "Visual Studio Code",
    group: "Editors",
    description: "Open the folder in VS Code.",
    candidates: ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe", "%ProgramFiles%\\Microsoft VS Code\\Code.exe"],
    build: openFolder("Open with VS Code"),
  },
  {
    id: "vscode-insiders",
    name: "VS Code Insiders",
    group: "Editors",
    description: "Open the folder in VS Code Insiders.",
    candidates: [
      "%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe",
      "%ProgramFiles%\\Microsoft VS Code Insiders\\Code - Insiders.exe",
    ],
    build: openFolder("Open with VS Code Insiders"),
  },
  {
    id: "cursor",
    name: "Cursor",
    group: "Editors",
    description: "Open the folder in Cursor.",
    candidates: ["%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe", "%ProgramFiles%\\Cursor\\Cursor.exe"],
    build: openFolder("Open with Cursor"),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    group: "Editors",
    description: "Open the folder in Windsurf.",
    candidates: ["%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe", "%ProgramFiles%\\Windsurf\\Windsurf.exe"],
    build: openFolder("Open with Windsurf"),
  },
  {
    id: "kiro",
    name: "Kiro",
    group: "Editors",
    description: "Open the folder in Kiro.",
    candidates: ["%LOCALAPPDATA%\\Programs\\Kiro\\Kiro.exe", "%ProgramFiles%\\Kiro\\Kiro.exe"],
    build: openFolder("Open with Kiro"),
  },
  {
    id: "antigravity",
    name: "Google Antigravity",
    group: "Editors",
    description: "Open the folder in Antigravity.",
    candidates: ["%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe"],
    build: openFolder("Open with Antigravity"),
  },
  {
    id: "zed",
    name: "Zed",
    group: "Editors",
    description: "Open the folder in Zed.",
    candidates: ["%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe", "%ProgramFiles%\\Zed\\Zed.exe"],
    build: openFolder("Open with Zed"),
  },
  {
    id: "sublime",
    name: "Sublime Text",
    group: "Editors",
    description: "Open the folder in Sublime Text.",
    candidates: ["%ProgramFiles%\\Sublime Text\\sublime_text.exe", "%ProgramFiles%\\Sublime Text 3\\sublime_text.exe"],
    build: openFolder("Open with Sublime Text"),
  },
  {
    id: "notepadpp",
    name: "Notepad++",
    group: "Editors",
    description: "Open the folder as a Notepad++ workspace.",
    candidates: ["%ProgramFiles%\\Notepad++\\notepad++.exe", "%ProgramFiles(x86)%\\Notepad++\\notepad++.exe"],
    build: (exe, icon) => ({ title: "Open with Notepad++", command: `"${exe}" -openFoldersAsWorkspace "%V"`, icon, kind: "command" }),
  },

  // ---------------------------------------------------------------- terminals and shells
  {
    id: "terminal",
    name: "Windows Terminal",
    group: "Terminals and shells",
    description: "Open Windows Terminal at the folder you right-clicked.",
    candidates: ["appx:Microsoft.WindowsTerminal\\WindowsTerminal.exe", "%LOCALAPPDATA%\\Microsoft\\WindowsApps\\wt.exe"],
    build: (_exe, icon) => ({ title: "Open in Windows Terminal", command: 'wt.exe -d "%V\\."', icon, kind: "command" }),
  },
  {
    id: "pwsh",
    name: "PowerShell 7",
    group: "Terminals and shells",
    description: "Open PowerShell 7 at the folder you right-clicked.",
    candidates: ["%ProgramFiles%\\PowerShell\\7\\pwsh.exe", "pwsh"],
    build: (exe, icon) => ({
      title: "PowerShell 7 here",
      command: `"${exe}" -NoExit -Command Set-Location -LiteralPath '%V'`,
      icon,
      kind: "command",
    }),
  },
  {
    id: "powershell",
    name: "Windows PowerShell",
    group: "Terminals and shells",
    description: "Open Windows PowerShell 5.1 at the folder you right-clicked.",
    candidates: ["%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"],
    build: (exe, icon) => ({
      title: "PowerShell here",
      command: `"${exe}" -NoExit -Command Set-Location -LiteralPath '%V'`,
      icon,
      kind: "command",
    }),
  },
  {
    id: "cmd",
    name: "Command Prompt",
    group: "Terminals and shells",
    description: "Open Command Prompt at the folder you right-clicked.",
    candidates: ["%SystemRoot%\\System32\\cmd.exe"],
    build: (exe, icon) => ({ title: "Command Prompt here", command: `"${exe}" /s /k pushd "%V"`, icon, kind: "command" }),
  },
  {
    id: "wsl",
    name: "WSL",
    group: "Terminals and shells",
    description: "Open your default WSL distro in Windows Terminal, starting in the folder you right-clicked.",
    candidates: ["%SystemRoot%\\System32\\wsl.exe"],
    build: (exe, icon) => ({ title: "Open Linux shell here", command: inTerminal(exe), icon, kind: "command" }),
  },
  {
    id: "gitbash",
    name: "Git Bash",
    group: "Terminals and shells",
    description: "Open Git Bash at the folder you right-clicked.",
    candidates: ["%ProgramFiles%\\Git\\git-bash.exe"],
    build: (exe, icon) => ({ title: "Git Bash here", command: `"${exe}" "--cd=%V"`, icon, kind: "command" }),
  },
  {
    id: "wezterm",
    name: "WezTerm",
    group: "Terminals and shells",
    description: "Open WezTerm at the folder you right-clicked.",
    candidates: ["%ProgramFiles%\\WezTerm\\wezterm-gui.exe"],
    build: (exe, icon) => ({ title: "Open WezTerm here", command: `"${exe}" start --cwd "%V"`, icon, kind: "command" }),
  },
  {
    id: "alacritty",
    name: "Alacritty",
    group: "Terminals and shells",
    description: "Open Alacritty at the folder you right-clicked.",
    candidates: ["%ProgramFiles%\\Alacritty\\alacritty.exe"],
    build: (exe, icon) => ({ title: "Open Alacritty here", command: `"${exe}" --working-directory "%V"`, icon, kind: "command" }),
  },

  // ---------------------------------------------------------------- git and file tools
  {
    id: "lazygit",
    name: "lazygit",
    group: "Git and file tools",
    description: "Open the lazygit TUI for this repository in Windows Terminal.",
    candidates: ["%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\lazygit.exe", "lazygit"],
    build: (exe, icon) => ({ title: "Open lazygit here", command: inTerminal(exe), icon: icon, kind: "command" }),
  },
  {
    id: "github-desktop",
    name: "GitHub Desktop",
    group: "Git and file tools",
    description: "Open the repository in GitHub Desktop.",
    candidates: ["%LOCALAPPDATA%\\GitHubDesktop\\GitHubDesktop.exe"],
    build: openFolder("Open in GitHub Desktop"),
  },
  {
    id: "yazi",
    name: "Yazi",
    group: "Git and file tools",
    description: "Browse the folder with the Yazi terminal file manager in Windows Terminal.",
    candidates: ["%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\yazi.exe", "yazi"],
    build: (exe, icon) => ({ title: "Open Yazi here", command: inTerminal(exe), icon: icon, kind: "command" }),
  },
];

const TARGETS = ["background", "folder", "desktop", "drive"];

/** Renders `--flags` and other code-like words as non-breaking code spans. */
const withCode = (text: string) =>
  text.split(/(--[\w-]+(?: yolo)?)/g).map((part, i) =>
    part.startsWith("--") ? (
      <code key={i} className="inline-code">
        {part}
      </code>
    ) : (
      part
    ),
  );

export function TemplatesPage({ locations }: { locations: Location[] }) {
  const notify = useNotify();
  const admin = useAdmin();
  const [found, setFound] = useState<Record<string, string | null> | null>(null);
  /** Icon to use per template: its exe if that has an icon, else Windows Terminal's. */
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(() => storageGet("fm.installedOnly") === "1");
  const [applying, setApplying] = useState<{ t: Template; exe: string } | null>(null);
  const [targets, setTargets] = useState<string[]>(["background", "folder"]);
  const [hive, setHive] = useState<Hive>("HKCU");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorMode | null>(null);

  useEffect(() => {
    (async () => {
      const wtIcon = await api.resolveProgram(["appx:Microsoft.WindowsTerminal\\WindowsTerminal.exe"]).catch(() => null);
      const resolved = await Promise.all(
        TEMPLATES.map(async (t) => {
          const exe = await api.resolveProgram(t.candidates).catch(() => null);
          // CLI shims (.cmd) and some exes carry no icon; show Terminal's instead.
          const hasIcon = !!exe && /\.exe$/i.test(exe) && !!(await api.iconFor(exe).catch(() => null));
          return { id: t.id, exe, icon: hasIcon ? exe : wtIcon };
        }),
      );
      setIcons(Object.fromEntries(resolved.map((r) => [r.id, r.icon])));
      setFound(Object.fromEntries(resolved.map((r) => [r.id, r.exe])));
    })();
  }, []);

  const byId = (id: string) => locations.find((l) => l.id === id);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter(
      (t) =>
        (!q || `${t.name} ${t.description} ${t.group}`.toLowerCase().includes(q)) &&
        (!installedOnly || !found || found[t.id]),
    );
  }, [query, installedOnly, found]);

  const apply = async () => {
    if (!applying) return;
    if (
      hive === "HKLM" &&
      !(await admin.ask("Installing for all users writes machine-wide registry keys, which needs administrator permission."))
    )
      return;
    setBusy(true);
    const input = applying.t.build(applying.exe, icons[applying.t.id] ?? null);
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

  const card = (t: Template) => {
    const exe = found?.[t.id];
    return (
      <div className="template" key={t.id}>
        <header>
          <EntryIcon icon={icons[t.id]} size={32} />
          {t.name}
        </header>
        <p>{withCode(t.description)}</p>
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
                  initial: t.build(exe, icons[t.id] ?? null),
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
  };

  return (
    <div className="page-inner">
      <div className="page-header">
        <div className="grow">
          <h1>Templates</h1>
          <p>Ready-made entries for programs installed on this PC.</p>
        </div>
      </div>

      <div className="row" style={{ alignItems: "center", marginBottom: 4 }}>
        <Input
          className="grow"
          contentBefore={<Search20Regular />}
          placeholder="Search templates"
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          style={{ maxWidth: 360 }}
        />
        <div style={{ flex: 1 }} />
        <Switch
          label="Installed only"
          checked={installedOnly}
          onChange={(_, d) => {
            setInstalledOnly(d.checked);
            storageSet("fm.installedOnly", d.checked ? "1" : "0");
          }}
        />
      </div>

      {!found && <Spinner label="Looking for installed programs..." />}
      {found &&
        GROUPS.map((g) => {
          const items = visible
            .filter((t) => t.group === g)
            .sort((a, b) => Number(!found[a.id]) - Number(!found[b.id]));
          if (!items.length) return null;
          return (
            <section key={g}>
              <div className="section-title">
                {g} <span className="count">{items.length}</span>
              </div>
              <div className="template-grid">{items.map(card)}</div>
            </section>
          );
        })}
      {found && !visible.length && <div className="empty">No templates match.</div>}

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
