import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Link,
  Toast,
  ToastBody,
  ToastTitle,
  ToastTrigger,
  useToastController,
} from "@fluentui/react-components";
import { AppGeneric20Regular, FolderList20Regular, ShieldKeyhole24Regular } from "@fluentui/react-icons";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, errorText } from "./api";

export const TOASTER_ID = "toaster";

interface NotifyOptions {
  body?: string;
  action?: { label: string; run: () => void };
}

export function useNotify() {
  const { dispatchToast } = useToastController(TOASTER_ID);
  const show = (intent: "success" | "error" | "info" | "warning", title: string, opts: NotifyOptions = {}) =>
    dispatchToast(
      <Toast>
        <ToastTitle
          action={
            opts.action ? (
              <ToastTrigger>
                <Link onClick={opts.action.run}>{opts.action.label}</Link>
              </ToastTrigger>
            ) : undefined
          }
        >
          {title}
        </ToastTitle>
        {opts.body && <ToastBody>{opts.body}</ToastBody>}
      </Toast>,
      { intent, timeout: intent === "error" ? 8000 : 4000 },
    );
  return {
    success: (t: string, o?: NotifyOptions) => show("success", t, o),
    info: (t: string, o?: NotifyOptions) => show("info", t, o),
    error: (t: string, e?: unknown) =>
      show("error", t, {
        body: e === undefined ? undefined : errorText(e),
        action: e !== undefined && isPermissionError(e) ? { label: "Restart as administrator", run: () => api.restartAsAdmin() } : undefined,
      }),
  };
}

/** Icon for a registry/Nilesoft entry: explicit icon spec first, then the command's exe. */
export function EntryIcon({
  icon,
  command,
  fallback,
  size = 24,
}: {
  icon?: string | null;
  command?: string | null;
  fallback?: ReactNode;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    (async () => {
      let url: string | null = null;
      if (icon) url = await api.iconFor(icon).catch(() => null);
      if (!url && command) url = await api.iconForCommand(command).catch(() => null);
      if (live) setSrc(url);
    })();
    return () => {
      live = false;
    };
  }, [icon, command]);
  return (
    <span className="entry-icon" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" style={{ width: size, height: size }} /> : (fallback ?? <AppGeneric20Regular />)}
    </span>
  );
}

export const FolderIcon = () => <FolderList20Regular />;

interface ConfirmState {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<(c: Omit<ConfirmState, "resolve">) => Promise<boolean>>(async () => false);

/** Fluent replacement for window.confirm (browser dialogs would block the webview). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const ask = (c: Omit<ConfirmState, "resolve">) =>
    new Promise<boolean>((resolve) => setState({ ...c, resolve }));
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={!!state} onOpenChange={(_, d) => !d.open && close(false)}>
        <DialogSurface style={{ maxWidth: 460 }}>
          <DialogBody>
            <DialogTitle>{state?.title}</DialogTitle>
            <DialogContent>{state?.body}</DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => close(true)}
                style={state?.danger ? { background: "#c42b1c", borderColor: "#c42b1c" } : undefined}
              >
                {state?.confirmLabel}
              </Button>
              <Button onClick={() => close(false)}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ---------------------------------------------------------------- admin gate

type AdminAsk = (reason: string) => Promise<boolean>;
const AdminContext = createContext<{ elevated: boolean; ask: AdminAsk }>({ elevated: false, ask: async () => true });

/**
 * Before a change that needs admin rights, offers to restart fluent-menu elevated
 * (no more prompts) or to continue with a one-off UAC prompt.
 */
export function AdminProvider({ elevated, children }: { elevated: boolean; children: ReactNode }) {
  const [pending, setPending] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);
  const ask: AdminAsk = (reason) =>
    elevated ? Promise.resolve(true) : new Promise((resolve) => setPending({ reason, resolve }));
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <AdminContext.Provider value={{ elevated, ask }}>
      {children}
      <Dialog open={!!pending} onOpenChange={(_, d) => !d.open && close(false)}>
        <DialogSurface className="admin-dialog">
          <DialogBody>
            <DialogTitle>
              <span className="admin-dialog-title">
                <span className="admin-dialog-icon">
                  <ShieldKeyhole24Regular />
                </span>
                Administrator permission needed
              </span>
            </DialogTitle>
            <DialogContent>
              <p className="admin-dialog-reason">{pending?.reason}</p>
              <ul className="admin-dialog-options">
                <li>
                  <strong>Restart as administrator</strong> to skip these prompts for the rest of the session.
                </li>
                <li>
                  <strong>Allow once</strong> to approve a single Windows prompt for this change.
                </li>
              </ul>
            </DialogContent>
          </DialogBody>
          <div className="admin-dialog-actions">
            <Button appearance="primary" onClick={() => api.restartAsAdmin().catch(() => close(false))}>
              Restart as administrator
            </Button>
            <Button onClick={() => close(true)}>Allow once</Button>
            <Button onClick={() => close(false)}>Cancel</Button>
          </div>
        </DialogSurface>
      </Dialog>
    </AdminContext.Provider>
  );
}

export const useAdmin = () => useContext(AdminContext);

/** True when an error came from a denied/cancelled elevation or access check. */
export const isPermissionError = (e: unknown) => /denied|cancel|administrator|access is/i.test(errorText(e));

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
