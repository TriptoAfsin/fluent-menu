import {
  Badge,
  Button,
  Dropdown,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Tab,
  TabList,
  Textarea,
  ToggleButton,
  Tooltip,
} from "@fluentui/react-components";
import {
  Add20Regular,
  ArrowDown20Regular,
  ArrowReset20Regular,
  ArrowUp20Regular,
  ChevronRight12Regular,
  Code16Regular,
  Delete16Regular,
  Delete20Regular,
  FolderOpen16Regular,
  FolderOpen20Regular,
  LineHorizontal1Regular,
  MoreHorizontal20Regular,
  Open16Regular,
  ArrowClockwise20Regular,
  Save20Regular,
  TextBulletListSquare16Regular,
  TextT16Regular,
  BracesVariable20Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type NilesoftInfo } from "../api";
import { browseIcon, browseProgram } from "../components/EntryEditor";
import {
  displayValue,
  findNode,
  findParent,
  getProp,
  importTarget,
  insertNode,
  isQuoted,
  makeItem,
  makeMenu,
  makeSeparator,
  moveNode,
  nodeTitle,
  parse,
  quote,
  removeNode,
  serialize,
  setProps,
  setRawText,
  type NssDocument,
  type NssNode,
  type Prop,
} from "../nss/parser";
import { EntryIcon, useAdmin, useConfirm, useNotify } from "../ui";

interface FileState {
  doc: NssDocument;
  original: string;
  /** Source text while the Source view is being edited. */
  draft: string | null;
}

const KNOWN_PROPS: { name: string; label: string; hint: string }[] = [
  { name: "title", label: "Title", hint: "Text shown in the menu" },
  { name: "image", label: "Image", hint: "Icon path, glyph (\\uE0xx) or icon.name" },
  { name: "cmd", label: "Command", hint: "Program or path to run" },
  { name: "args", label: "Arguments", hint: "Arguments passed to the command" },
  { name: "cmd-line", label: "Command line", hint: "Arguments for cmd.exe" },
  { name: "where", label: "Show when", hint: "Condition, e.g. sel.count > 1" },
  { name: "type", label: "Applies to", hint: "file, dir, drive, back, desktop, taskbar, *" },
  { name: "mode", label: "Selection", hint: "none, single, multi_unique, multi_single, multiple" },
  { name: "admin", label: "Run as admin", hint: "true or an expression" },
  { name: "tip", label: "Tooltip", hint: "Tooltip text" },
  { name: "sep", label: "Separator", hint: "top, bottom, both" },
  { name: "vis", label: "Visibility", hint: "normal, disable, hidden, remove, or an expression" },
  { name: "pos", label: "Position", hint: "top, middle, bottom, or a number" },
  { name: "keys", label: "Shortcut hint", hint: "Text shown on the right, e.g. ctrl+c" },
  { name: "dir", label: "Working folder", hint: "Folder the command starts in" },
  { name: "window", label: "Window", hint: "hidden, show, minimized, maximized" },
  { name: "find", label: "Find", hint: "Pattern matching existing items" },
  { name: "menu", label: "Move to menu", hint: "Title of the target menu" },
  { name: "checked", label: "Checked", hint: "Shows a check mark" },
  { name: "default", label: "Default", hint: "Bold default item" },
  { name: "wait", label: "Wait", hint: "Wait for the command to finish" },
];

const labelFor = (name: string) => KNOWN_PROPS.find((p) => p.name === name.toLowerCase())?.label ?? name;
const hintFor = (name: string) => KNOWN_PROPS.find((p) => p.name === name.toLowerCase())?.hint;

const clone = (d: NssDocument): NssDocument => structuredClone(d);

export function NilesoftPage({ info, onChanged }: { info: NilesoftInfo; onChanged?: () => void }) {
  const notify = useNotify();
  const confirm = useConfirm();
  const admin = useAdmin();
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [current, setCurrent] = useState(info.files[0]?.path ?? "");
  const [selected, setSelected] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [view, setView] = useState<"visual" | "source">("visual");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const state = files[current];
  const doc = state?.doc;
  const text = state ? (state.draft ?? serialize(state.doc)) : "";
  const dirtyOf = (p: string) => {
    const f = files[p];
    return !!f && (f.draft ?? serialize(f.doc)) !== f.original;
  };
  const dirty = dirtyOf(current);
  const fileName = info.files.find((f) => f.path === current)?.name ?? "";

  useEffect(() => {
    if (!current || files[current]) return;
    setLoadError(null);
    api
      .nilesoftRead(current)
      .then((src) => setFiles((fs) => ({ ...fs, [current]: { doc: parse(src), original: src, draft: null } })))
      .catch((e) => setLoadError(String(e)));
  }, [current, files]);

  const edit = useCallback(
    (fn: (d: NssDocument) => void) => {
      setFiles((fs) => {
        const f = fs[current];
        if (!f) return fs;
        const d = clone(f.doc);
        fn(d);
        return { ...fs, [current]: { ...f, doc: d } };
      });
    },
    [current],
  );

  const selectedNode = doc && selected != null ? findNode(doc, selected) : null;

  const switchView = (v: "visual" | "source") => {
    if (v === view || !state) return;
    if (v === "source") {
      setFiles((fs) => ({ ...fs, [current]: { ...state, draft: serialize(state.doc) } }));
    } else {
      setFiles((fs) => ({ ...fs, [current]: { ...state, doc: parse(state.draft ?? ""), draft: null } }));
      setSelected(null);
    }
    setView(v);
  };

  const add = (kind: "item" | "menu" | "separator") => {
    if (!doc) return;
    const node =
      kind === "item"
        ? makeItem([{ name: "title", value: "'New item'" }, { name: "cmd", value: "''" }])
        : kind === "menu"
          ? makeMenu([{ name: "title", value: "'New menu'" }], "")
          : makeSeparator();
    edit((d) => {
      const target = selected != null ? findNode(d, selected) : null;
      if (target?.kind === "menu" && !collapsed.has(target.id)) insertNode(d, node, { intoId: target.id });
      else if (target) insertNode(d, node, { afterId: target.id });
      else insertNode(d, node, {});
    });
    setSelected(node.id);
  };

  const remove = async () => {
    if (!doc || selected == null) return;
    const n = findNode(doc, selected);
    if (!n) return;
    if (n.kind === "menu" && n.children.length) {
      const ok = await confirm({
        title: `Delete "${nodeTitle(n)}"?`,
        body: `This menu has ${n.children.length} child entries. They will be deleted too.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
    }
    const loc = findParent(doc, selected);
    const next = loc ? (loc.list[loc.index + 1] ?? loc.list[loc.index - 1] ?? loc.parent) : null;
    edit((d) => removeNode(d, selected));
    setSelected(next?.id ?? null);
  };

  const move = (delta: -1 | 1) => selected != null && edit((d) => void moveNode(d, selected, delta));

  const save = async () => {
    if (!state) return;
    if (!info.writable && !(await admin.ask("Nilesoft Shell's config is in a protected folder, so saving needs administrator permission. Unsaved edits are lost if you restart."))) return;
    setSaving(true);
    try {
      await api.nilesoftWrite(current, text);
      setFiles((fs) => ({ ...fs, [current]: { ...fs[current], original: text } }));
      notify.success(`Saved ${fileName}`, {
        body: "A backup of the previous version was kept.",
        action: { label: "Reload Nilesoft", run: () => api.nilesoftRestart().catch((e) => notify.error("Couldn't reload", e)) },
      });
      onChanged?.();
    } catch (e) {
      notify.error("Couldn't save", e);
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    if (!state) return;
    setFiles((fs) => ({ ...fs, [current]: { doc: parse(state.original), original: state.original, draft: view === "source" ? state.original : null } }));
    setSelected(null);
  };

  // Ctrl+S saves, Delete removes the selected node (when focus isn't in a text field).
  const saveRef = useRef(save);
  saveRef.current = save;
  const removeRef = useRef(remove);
  removeRef.current = remove;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "Delete" && view === "visual" && tag !== "INPUT" && tag !== "TEXTAREA") removeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const openImport = (target: string) => {
    const wanted = `${info.installDir}\\${target.replace(/\//g, "\\")}`.toLowerCase();
    const f = info.files.find((x) => x.path.toLowerCase() === wanted);
    if (f) {
      setCurrent(f.path);
      setSelected(null);
      setView("visual");
    } else notify.error(`Couldn't find ${target}`);
  };

  const renderTree = (nodes: NssNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const isMenu = n.kind === "menu";
      const open = isMenu && !collapsed.has(n.id);
      const image = n.kind === "item" || n.kind === "menu" ? getProp(n.props, "image")?.value : null;
      const cmd = n.kind === "item" ? getProp(n.props, "cmd", "cmd-line")?.value : null;
      const imagePath = image && isQuoted(image) && /[\\/.]/.test(image) ? displayValue(image) : null;
      const imp = importTarget(n);
      return (
        <div key={n.id}>
          <div
            className={`tree-row ${n.kind === "raw" ? "raw" : ""} ${n.kind === "separator" ? "sep" : ""} ${selected === n.id ? "selected" : ""}`}
            style={{ paddingLeft: 6 + depth * 18 }}
            onClick={() => setSelected(n.id)}
            onDoubleClick={() => imp && openImport(imp)}
          >
            <span
              className="twisty"
              onClick={(e) => {
                if (!isMenu) return;
                e.stopPropagation();
                setCollapsed((s) => {
                  const c = new Set(s);
                  if (c.has(n.id)) c.delete(n.id);
                  else c.add(n.id);
                  return c;
                });
              }}
            >
              {isMenu && <ChevronRight12Regular className={`chevron${open ? " open" : ""}`} />}
            </span>
            {n.kind === "menu" && <TextBulletListSquare16Regular />}
            {n.kind === "item" &&
              (imagePath || cmd ? (
                <EntryIcon icon={imagePath} command={cmd && isQuoted(cmd) ? displayValue(cmd) : null} size={16} />
              ) : (
                <span className="entry-icon" style={{ width: 16, height: 16 }}>
                  <TextT16Regular />
                </span>
              ))}
            {n.kind === "separator" && <LineHorizontal1Regular fontSize={16} />}
            {n.kind === "raw" && <Code16Regular />}
            <span className="t-title">{nodeTitle(n)}</span>
            {cmd && <span className="t-sub">{displayValue(cmd)}</span>}
            {imp && (
              <Tooltip content={`Open ${imp}`} relationship="label">
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Open16Regular />}
                  onClick={(e) => {
                    e.stopPropagation();
                    openImport(imp);
                  }}
                />
              </Tooltip>
            )}
          </div>
          {open && renderTree(n.children, depth + 1)}
        </div>
      );
    });

  const fileOptions = useMemo(() => info.files, [info.files]);

  return (
    <div className="page-inner" style={{ maxWidth: 1200 }}>
      <div className="page-header">
        <div className="grow">
          <h1>
            Nilesoft Shell{" "}
            {info.version && (
              <Badge appearance="tint" color="success" style={{ verticalAlign: "middle" }}>
                {info.version} detected
              </Badge>
            )}
          </h1>
          <p className="selectable">{info.installDir}</p>
        </div>
        <div className="page-actions">
          <Tooltip content="Reload Nilesoft (restarts Explorer)" relationship="label">
            <Button icon={<ArrowClockwise20Regular />} onClick={() => api.nilesoftRestart().catch((e) => notify.error("Couldn't reload", e))} />
          </Tooltip>
          <Button icon={<FolderOpen20Regular />} onClick={() => api.openPath(info.installDir)}>
            Open folder
          </Button>
        </div>
      </div>

      {!info.writable && (
        <MessageBar className="banner" intent="info">
          <MessageBarBody>The config lives in a protected folder, so saving asks for admin permission. A backup is kept every time.</MessageBarBody>
        </MessageBar>
      )}

      <div className="row" style={{ marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Dropdown
          value={fileName}
          selectedOptions={[current]}
          onOptionSelect={(_, d) => {
            if (!d.optionValue) return;
            setCurrent(d.optionValue);
            setSelected(null);
            setView(files[d.optionValue]?.draft != null ? "source" : "visual");
          }}
          style={{ minWidth: 220 }}
        >
          {fileOptions.map((f) => (
            <Option key={f.path} value={f.path} text={f.name}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {f.name}
                {dirtyOf(f.path) && <span className="dirty-dot" />}
              </span>
            </Option>
          ))}
        </Dropdown>
        <TabList size="small" selectedValue={view} onTabSelect={(_, d) => switchView(d.value as "visual" | "source")}>
          <Tab value="visual">Visual</Tab>
          <Tab value="source">Source</Tab>
        </TabList>
        <div style={{ flex: 1 }} />
        {dirty && <span style={{ fontSize: 12, color: "var(--text-2)" }}>Unsaved changes</span>}
        <Button icon={<ArrowReset20Regular />} disabled={!dirty} onClick={revert}>
          Revert
        </Button>
        <Button appearance="primary" icon={saving ? <Spinner size="tiny" /> : <Save20Regular />} disabled={!dirty || saving} onClick={save}>
          Save
        </Button>
      </div>

      {loadError && (
        <MessageBar intent="error" className="banner">
          <MessageBarBody>{loadError}</MessageBarBody>
        </MessageBar>
      )}
      {!state && !loadError && <Spinner />}

      {state && view === "source" && (
        <Textarea
          className="source"
          textarea={{ className: "source", spellCheck: false, style: { maxHeight: "none" } }}
          value={state.draft ?? ""}
          onChange={(_, d) => setFiles((fs) => ({ ...fs, [current]: { ...fs[current], draft: d.value } }))}
          resize="vertical"
        />
      )}

      {state && doc && view === "visual" && (
        <div className="nss-layout">
          <div className="nss-pane">
            <div className="pane-head">
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button size="small" appearance="subtle" icon={<Add20Regular />}>
                    Add
                  </Button>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => add("item")}>Item</MenuItem>
                    <MenuItem onClick={() => add("menu")}>Menu</MenuItem>
                    <MenuItem onClick={() => add("separator")}>Separator</MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Tooltip content="Move up" relationship="label">
                <Button size="small" appearance="subtle" icon={<ArrowUp20Regular />} disabled={selected == null} onClick={() => move(-1)} />
              </Tooltip>
              <Tooltip content="Move down" relationship="label">
                <Button size="small" appearance="subtle" icon={<ArrowDown20Regular />} disabled={selected == null} onClick={() => move(1)} />
              </Tooltip>
              <Tooltip content="Delete (Del)" relationship="label">
                <Button size="small" appearance="subtle" icon={<Delete20Regular />} disabled={selected == null} onClick={remove} />
              </Tooltip>
              <div style={{ flex: 1 }} />
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button size="small" appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label="More" />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem onClick={() => setCollapsed(new Set())}>Expand all</MenuItem>
                    <MenuItem
                      onClick={() => {
                        const ids = new Set<number>();
                        const walk = (ns: NssNode[]) => ns.forEach((n) => n.kind === "menu" && (ids.add(n.id), walk(n.children)));
                        walk(doc.nodes);
                        setCollapsed(ids);
                      }}
                    >
                      Collapse all
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </div>
            <div className="pane-body" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
              {doc.nodes.length ? renderTree(doc.nodes, 0) : <div className="empty">This file is empty. Add an item to start.</div>}
            </div>
          </div>

          <div className="nss-pane">
            <div className="pane-head">{selectedNode ? `${selectedNode.kind[0].toUpperCase()}${selectedNode.kind.slice(1)} properties` : "Properties"}</div>
            <div className="pane-body">
              {!selectedNode && (
                <div style={{ padding: 16, color: "var(--text-2)", fontSize: 13 }}>
                  Select an entry to edit it. Statements Fluent Menu doesn't model visually (settings, modify, remove, variables) show as code
                  and can be edited as text.
                </div>
              )}
              {selectedNode && (selectedNode.kind === "item" || selectedNode.kind === "menu") && (
                <PropEditor
                  key={selectedNode.id}
                  props={selectedNode.props}
                  onChange={(props) => edit((d) => setProps(d, selectedNode.id, props))}
                />
              )}
              {selectedNode && (selectedNode.kind === "raw" || selectedNode.kind === "separator") && (
                <RawEditor key={selectedNode.id} text={selectedNode.text} onApply={(t) => edit((d) => setRawText(d, selectedNode.id, t))} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PropEditor({ props, onChange }: { props: Prop[]; onChange: (p: Prop[]) => void }) {
  const set = (i: number, p: Prop) => onChange(props.map((x, j) => (j === i ? p : x)));
  const missing = KNOWN_PROPS.filter((k) => !props.some((p) => p.name.toLowerCase() === k.name));
  const [custom, setCustom] = useState("");

  return (
    <div className="props">
      {props.map((p, i) => {
        const quoted = isQuoted(p.value);
        const name = p.name.toLowerCase();
        const browse = name === "image" ? browseIcon : name === "cmd" ? () => browseProgram() : null;
        return (
          <div className="prop-row" key={i}>
            <Tooltip content={hintFor(p.name) ?? p.name} relationship="description">
              <label>{labelFor(p.name)}</label>
            </Tooltip>
            {p.value === null ? (
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                Flag <span className="mono">{p.name}</span> is on
              </span>
            ) : (
              <Input
                size="small"
                className={quoted ? "" : "mono"}
                value={quoted ? displayValue(p.value) : p.value}
                placeholder={hintFor(p.name)}
                onChange={(_, d) =>
                  set(i, { ...p, value: quoted ? quote(d.value, p.value![0] as "'" | '"') : d.value })
                }
                contentBefore={
                  name === "image" && quoted && /[\\/.]/.test(p.value) ? <EntryIcon icon={displayValue(p.value)} size={16} /> : undefined
                }
              />
            )}
            <div style={{ display: "flex" }}>
              {browse && (
                <Tooltip content="Browse" relationship="label">
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<FolderOpen16Regular />}
                    onClick={async () => {
                      const path = await browse();
                      if (path) set(i, { ...p, value: quote(path) });
                    }}
                  />
                </Tooltip>
              )}
              {p.value !== null && (
                <Tooltip content={quoted ? "Text. Switch to expression" : "Expression. Switch to text"} relationship="label">
                  <ToggleButton
                    size="small"
                    appearance="subtle"
                    checked={!quoted}
                    icon={quoted ? <TextT16Regular /> : <BracesVariable20Regular />}
                    onClick={() => set(i, { ...p, value: quoted ? displayValue(p.value) || "null" : quote(p.value!) })}
                  />
                </Tooltip>
              )}
              <Tooltip content="Remove property" relationship="label">
                <Button size="small" appearance="subtle" icon={<Delete16Regular />} onClick={() => onChange(props.filter((_, j) => j !== i))} />
              </Tooltip>
            </div>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 4 }}>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button size="small" icon={<Add20Regular />}>
              Add property
            </Button>
          </MenuTrigger>
          <MenuPopover style={{ maxHeight: 360, overflowY: "auto" }}>
            <MenuList>
              {missing.map((k) => (
                <MenuItem key={k.name} secondaryContent={k.name} onClick={() => onChange([...props, { name: k.name, value: "''" }])}>
                  {k.label}
                </MenuItem>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <Input
          size="small"
          placeholder="custom name"
          value={custom}
          onChange={(_, d) => setCustom(d.value.replace(/[^\w.\-]/g, ""))}
          style={{ width: 130 }}
          className="mono"
        />
        <Button
          size="small"
          disabled={!custom}
          onClick={() => {
            onChange([...props, { name: custom, value: "''" }]);
            setCustom("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function RawEditor({ text, onApply }: { text: string; onApply: (t: string) => void }) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <div className="props">
      <Textarea
        value={draft}
        onChange={(_, d) => setDraft(d.value)}
        textarea={{ className: "mono", spellCheck: false, style: { fontSize: 12.5, minHeight: 160 } }}
        resize="vertical"
      />
      <div className="row">
        <Button size="small" appearance="primary" disabled={draft === text} onClick={() => onApply(draft)}>
          Apply
        </Button>
        <Button size="small" disabled={draft === text} onClick={() => setDraft(text)}>
          Discard
        </Button>
      </div>
    </div>
  );
}
