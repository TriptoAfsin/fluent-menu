import {
  Button,
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Switch,
  Tooltip,
} from "@fluentui/react-components";
import {
  Add20Regular,
  AddSquare20Regular,
  ArrowClockwise20Regular,
  ArrowExport20Regular,
  ArrowImport20Regular,
  ChevronRight16Regular,
  Delete20Regular,
  Edit20Regular,
  MoreHorizontal20Regular,
  Open20Regular,
  PuzzlePiece20Regular,
  ShieldKeyhole16Regular,
  TextBulletListSquare20Regular,
} from "@fluentui/react-icons";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  shellPath,
  type Location,
  type LocationScan,
  type MenuEntry,
  type ShellHandler,
} from "../api";
import { EntryEditor, type EditorMode } from "../components/EntryEditor";
import {
  EntryIcon,
  storageGet,
  storageSet,
  useAdmin,
  useConfirm,
  useNotify,
} from "../ui";

const ALL_USERS =
  "This entry is installed for all users, so changing it needs administrator permission.";

export function LocationPage({
  location,
  elevated,
}: {
  location: Location;
  elevated: boolean;
}) {
  const notify = useNotify();
  const confirm = useConfirm();
  const admin = useAdmin();
  const isFileType = location.base.includes("{ext}");
  const [ext, setExt] = useState(() => storageGet("fm.ext") ?? ".txt");
  const [extInput, setExtInput] = useState(ext);
  const base = isFileType ? location.base.replace("{ext}", ext) : location.base;

  const [scan, setScan] = useState<LocationScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setScan(await api.scanLocation(base));
    } catch (e) {
      notify.error("Couldn't read the registry", e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  useEffect(() => {
    setScan(null);
    refresh();
  }, [refresh]);

  const run = async (
    key: string,
    action: () => Promise<void>,
    ok?: string,
    adminReason?: string,
  ) => {
    if (adminReason && !(await admin.ask(adminReason))) return;
    setBusyKey(key);
    try {
      await action();
      if (ok) notify.success(ok);
      await refresh();
    } catch (e) {
      notify.error("That didn't work", e);
    } finally {
      setBusyKey(null);
    }
  };

  const toggleExpanded = (k: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const exportEntry = async (e: MenuEntry) => {
    const dest = await save({
      title: "Export entry",
      defaultPath: `${e.keyName.replace(/[^\w\- ]/g, "_")}.reg`,
      filters: [{ name: "Registry file", extensions: ["reg"] }],
    });
    if (dest)
      run(
        e.keyPath,
        () => api.exportEntry(e.hive, e.keyPath, dest),
        "Exported",
      );
  };

  const importReg = async () => {
    const path = await open({
      title: "Import a .reg file",
      filters: [{ name: "Registry file", extensions: ["reg"] }],
    });
    if (typeof path !== "string") return;
    const text = await api.readReg(path).catch(() => "");
    const ok = await confirm({
      title: "Import this .reg file?",
      body: (
        <>
          <p style={{ marginTop: 0 }}>
            It will be merged into your registry. Only import files you trust.
          </p>
          <pre
            className="mono selectable"
            style={{
              maxHeight: 220,
              overflow: "auto",
              fontSize: 11,
              margin: 0,
            }}
          >
            {text.slice(0, 4000)}
          </pre>
        </>
      ),
      confirmLabel: "Import",
    });
    const machine = /HKEY_LOCAL_MACHINE|HKEY_CLASSES_ROOT/i.test(text);
    if (ok)
      run(
        "import",
        () => api.importReg(path),
        "Imported",
        machine
          ? "This file changes machine-wide registry keys, which needs administrator permission."
          : undefined,
      );
  };

  const remove = async (e: MenuEntry) => {
    const ok = await confirm({
      title: `Delete "${e.title}"?`,
      body: "The registry key is backed up first, so you can restore it from Backups.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok)
      run(
        e.keyPath,
        () => api.deleteEntry(e.hive, e.keyPath),
        `Deleted "${e.title}"`,
        e.hive === "HKLM" ? ALL_USERS : undefined,
      );
  };

  const toggleHandler = (h: ShellHandler, enabled: boolean) =>
    run(
      h.clsid,
      async () => {
        await api.setHandlerBlocked(h.clsid, !enabled);
        notify.info(enabled ? `Enabled ${h.name}` : `Disabled ${h.name}`, {
          body: "Restart Explorer for shell extension changes to apply.",
          action: {
            label: "Restart Explorer",
            run: () => api.restartExplorer(),
          },
        });
      },
      undefined,
      "Shell extensions are turned on and off for all users, which needs administrator permission.",
    );

  const renderEntry = (e: MenuEntry, depth = 0): React.ReactNode => {
    const key = `${e.hive}:${e.keyPath}`;
    const open = expanded.has(key);
    const isSub = e.kind === "submenu";
    const needsAdmin = e.hive === "HKLM" && !elevated;
    return (
      <div key={key}>
        <div
          className={`card${e.disabled ? " dimmed" : ""}${isSub ? " clickable" : ""}`}
          onClick={isSub ? () => toggleExpanded(key) : undefined}
        >
          {isSub && (
            <ChevronRight16Regular
              className={`chevron${open ? " open" : ""}`}
              style={{ marginRight: -8 }}
            />
          )}
          <EntryIcon
            icon={e.icon}
            command={e.command}
            fallback={isSub ? <TextBulletListSquare20Regular /> : undefined}
          />
          <div className="card-main">
            <div className="card-title">
              <span>{e.title}</span>
              {e.hive === "HKLM" && (
                <Tooltip
                  content="Installed for all users. Changing it asks for admin permission."
                  relationship="description"
                >
                  <span className="tag">
                    <ShieldKeyhole16Regular />
                    All users
                  </span>
                </Tooltip>
              )}
              {isSub && (
                <span className="tag accent">
                  {e.externalChildren && !e.children.length
                    ? "Submenu"
                    : `Submenu · ${e.children.length}`}
                </span>
              )}
              {e.kind === "handler" && (
                <Tooltip
                  content="Runs through a COM handler instead of a command line."
                  relationship="description"
                >
                  <span className="tag">Handler</span>
                </Tooltip>
              )}
              {e.extended && (
                <Tooltip content="Only shown when Shift is held." relationship="description">
                  <span className="tag">Shift</span>
                </Tooltip>
              )}
            </div>
            <div
              className="card-sub mono selectable"
              title={e.command ?? e.keyPath}
            >
              {e.command ??
                (isSub ? e.keyName : e.keyPath.split("\\").slice(-1)[0])}
            </div>
          </div>
          {busyKey === e.keyPath && <Spinner size="tiny" />}
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            {depth === 0 && (
              <Tooltip
                content={
                  e.disabled ? "Hidden from the menu" : "Shown in the menu"
                }
                relationship="description"
              >
                <Switch
                  checked={!e.disabled}
                  onChange={(_, d) =>
                    run(
                      e.keyPath,
                      () => api.setEntryEnabled(e.hive, e.keyPath, d.checked),
                      undefined,
                      e.hive === "HKLM" ? ALL_USERS : undefined,
                    )
                  }
                  aria-label={`Show ${e.title}`}
                />
              </Tooltip>
            )}
            <Menu positioning="below-end">
              <MenuTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  icon={<MoreHorizontal20Regular />}
                  aria-label="More actions"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem
                    icon={<Edit20Regular />}
                    onClick={() => setEditor({ type: "edit", entry: e })}
                  >
                    Edit{needsAdmin ? " (admin)" : ""}
                  </MenuItem>
                  {isSub && !e.externalChildren && (
                    <MenuItem
                      icon={<AddSquare20Regular />}
                      onClick={() =>
                        setEditor({
                          type: "create",
                          parentShell: `${e.keyPath}\\shell`,
                          numbered: true,
                          hive: e.hive,
                          allowScope: false,
                          heading: `Add an item to "${e.title}"`,
                          initial: { title: "", kind: "command", icon: e.icon },
                        })
                      }
                    >
                      Add item to submenu
                    </MenuItem>
                  )}
                  <MenuItem
                    icon={<ArrowExport20Regular />}
                    onClick={() => exportEntry(e)}
                  >
                    Export as .reg
                  </MenuItem>
                  <MenuItem
                    icon={<Open20Regular />}
                    onClick={() =>
                      api
                        .openInRegedit(e.hive, e.keyPath)
                        .catch((x) =>
                          notify.error("Couldn't open Registry Editor", x),
                        )
                    }
                  >
                    Open in Registry Editor
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem
                    icon={<Delete20Regular />}
                    onClick={() => remove(e)}
                  >
                    Delete
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        </div>
        {isSub && open && (
          <div className="card-children">
            {e.children.length ? (
              e.children.map((c) => renderEntry(c, depth + 1))
            ) : (
              <div
                className="card-sub"
                style={{
                  padding: "8px 4px",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                {e.externalChildren
                  ? "Items come from a shared command store and can't be listed here."
                  : "No items yet."}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const entries = scan?.entries ?? [];
  const handlers = scan?.handlers ?? [];

  return (
    <div className="page-inner">
      <div className="page-header">
        <div className="grow">
          <h1>{location.label}</h1>
          <p>{location.description}</p>
        </div>
        <div className="page-actions">
          <Tooltip content="Refresh" relationship="label">
            <Button icon={<ArrowClockwise20Regular />} onClick={refresh} />
          </Tooltip>
          <Button icon={<ArrowImport20Regular />} onClick={importReg}>
            Import .reg
          </Button>
          <Button
            appearance="primary"
            icon={<Add20Regular />}
            onClick={() =>
              setEditor({ type: "create", parentShell: shellPath(base) })
            }
          >
            New entry
          </Button>
        </div>
      </div>

      {isFileType && (
        <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
          <Input
            value={extInput}
            onChange={(_, d) => setExtInput(d.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()
            }
            onBlur={() => {
              const v = extInput.trim().replace(/^\.?/, ".").toLowerCase();
              setExtInput(v);
              setExt(v);
              storageSet("fm.ext", v);
            }}
            contentBefore={
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                Extension
              </span>
            }
            style={{ width: 240 }}
          />
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>
            Entries under{" "}
            <span className="mono">SystemFileAssociations\{ext}</span>
          </span>
        </div>
      )}

      <div className="section-title">
        Menu entries <span className="count">{scan ? entries.length : ""}</span>
        {loading && <Spinner size="extra-tiny" />}
      </div>
      <div className="cards">
        {scan && !entries.length && (
          <div className="empty">
            No entries here yet. Add one with New entry or start from a
            template.
          </div>
        )}
        {entries.map((e) => renderEntry(e))}
      </div>

      {handlers.length > 0 && (
        <>
          <div className="section-title">
            Shell extensions <span className="count">{handlers.length}</span>
          </div>
          <div className="cards">
            {handlers.map((h) => (
              <div
                className={`card${h.blocked ? " dimmed" : ""}`}
                key={`${h.hive}:${h.keyName}`}
              >
                <EntryIcon icon={h.dll} fallback={<PuzzlePiece20Regular />} />
                <div className="card-main">
                  <div className="card-title">
                    {h.name}
                    <span className="tag">Extension</span>
                  </div>
                  <div
                    className="card-sub mono selectable"
                    title={h.dll ?? h.clsid}
                  >
                    {h.dll ?? h.clsid}
                  </div>
                </div>
                {busyKey === h.clsid && <Spinner size="tiny" />}
                <Tooltip
                  content="Turning extensions on or off applies to all users and needs admin permission."
                  relationship="description"
                >
                  <Switch
                    checked={!h.blocked}
                    onChange={(_, d) => toggleHandler(h, d.checked)}
                    aria-label={`Enable ${h.name}`}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        </>
      )}

      <EntryEditor
        mode={editor}
        onClose={() => setEditor(null)}
        onSaved={refresh}
      />
    </div>
  );
}
