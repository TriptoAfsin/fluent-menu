import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Spinner } from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  ArrowUndo20Regular,
  Delete20Regular,
  DocumentText20Regular,
  FolderOpen20Regular,
  MoreHorizontal20Regular,
  Code20Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useState } from "react";
import { api, type Backup } from "../api";
import { useConfirm, useNotify } from "../ui";

const LABELS: Record<string, string> = { edit: "Before edit", delete: "Before delete", save: "Before save" };

export function BackupsPage({ backupsDir }: { backupsDir: string }) {
  const notify = useNotify();
  const confirm = useConfirm();
  const [items, setItems] = useState<Backup[] | null>(null);

  const refresh = useCallback(() => {
    api.listBackups().then(setItems).catch((e) => notify.error("Couldn't list backups", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(refresh, [refresh]);

  const restore = async (b: Backup) => {
    const ok = await confirm({
      title: "Restore this backup?",
      body:
        b.kind === "registry"
          ? `The registry key "${b.name}" goes back to how it was on ${new Date(b.createdMs).toLocaleString()}.`
          : `${b.name} goes back to the version from ${new Date(b.createdMs).toLocaleString()}. The current file is backed up first.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    try {
      await api.restoreBackup(b);
      notify.success("Restored");
      refresh();
    } catch (e) {
      notify.error("Couldn't restore", e);
    }
  };

  const remove = async (b: Backup) => {
    try {
      await api.deleteBackup(b.path);
      refresh();
    } catch (e) {
      notify.error("Couldn't delete", e);
    }
  };

  return (
    <div className="page-inner">
      <div className="page-header">
        <div className="grow">
          <h1>Backups</h1>
          <p>fluent-menu saves a copy before every edit, delete and Nilesoft save.</p>
        </div>
        <div className="page-actions">
          <Button icon={<ArrowClockwise20Regular />} onClick={refresh} aria-label="Refresh" />
          <Button icon={<FolderOpen20Regular />} onClick={() => api.openPath(backupsDir)}>
            Open folder
          </Button>
        </div>
      </div>
      {!items && <Spinner />}
      {items && !items.length && <div className="empty">No backups yet. They appear here after your first change.</div>}
      <div className="cards">
        {items?.map((b) => (
          <div className="card" key={b.path} style={{ minHeight: 56 }}>
            <span className="entry-icon">{b.kind === "registry" ? <DocumentText20Regular /> : <Code20Regular />}</span>
            <div className="card-main">
              <div className="card-title">
                {b.name}
                <span className="tag">{b.kind === "registry" ? "Registry" : "Nilesoft"}</span>
              </div>
              <div className="card-sub">
                {LABELS[b.label] ?? b.label} · {new Date(b.createdMs).toLocaleString()} · {(b.size / 1024).toFixed(1)} KB
              </div>
            </div>
            <Button icon={<ArrowUndo20Regular />} onClick={() => restore(b)}>
              Restore
            </Button>
            <Menu positioning="below-end">
              <MenuTrigger disableButtonEnhancement>
                <Button appearance="subtle" icon={<MoreHorizontal20Regular />} aria-label="More" />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<Delete20Regular />} onClick={() => remove(b)}>
                    Delete backup
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        ))}
      </div>
    </div>
  );
}
