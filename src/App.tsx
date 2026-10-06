import {
  Button,
  FluentProvider,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Toaster,
} from "@fluentui/react-components";
import {
  Desktop20Regular,
  Dismiss20Regular,
  Document20Regular,
  DocumentCopy20Regular,
  Folder20Regular,
  FolderOpen20Regular,
  HardDrive20Regular,
  History20Regular,
  LayerDiagonal20Regular,
  Settings20Regular,
  Sparkle20Regular,
  WindowWrench20Regular,
  DocumentFolder20Regular,
} from "@fluentui/react-icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { api, type Location, type NilesoftInfo, type SystemInfo } from "./api";
import { BackupsPage } from "./pages/BackupsPage";
import { LocationPage } from "./pages/LocationPage";
import { NilesoftPage } from "./pages/NilesoftPage";
import { SettingsPage, type ThemePref } from "./pages/SettingsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { makeTheme } from "./theme";
import {
  AdminProvider,
  ConfirmProvider,
  storageGet,
  storageSet,
  TOASTER_ID,
} from "./ui";

const LOCATION_ICONS: Record<string, ReactElement> = {
  background: <FolderOpen20Regular />,
  desktop: <Desktop20Regular />,
  folder: <Folder20Regular />,
  files: <Document20Regular />,
  filesystem: <DocumentFolder20Regular />,
  drive: <HardDrive20Regular />,
  filetype: <DocumentCopy20Regular />,
};

/**
 * System light/dark as Windows reports it for apps. Read from the native window rather
 * than prefers-color-scheme, which can disagree with it and leave Mica and the content
 * in different themes (light text on a light backdrop).
 */
function useSystemDark() {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const win = getCurrentWindow();
    win.theme().then((t) => t && setDark(t === "dark"));
    const un = win.onThemeChanged(({ payload }) => setDark(payload === "dark"));
    return () => {
      un.then((f) => f());
    };
  }, []);
  return dark;
}

export default function App() {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [nilesoft, setNilesoft] = useState<NilesoftInfo | null>(null);
  const [page, setPage] = useState(
    () => storageGet("fm.page") ?? "loc:background",
  );
  const [themePref, setThemePref] = useState<ThemePref>(
    () => (storageGet("fm.theme") as ThemePref) ?? "system",
  );
  const [bannerDismissed, setBannerDismissed] = useState(
    () => storageGet("fm.nilesoftBanner") === "dismissed",
  );
  const systemDark = useSystemDark();
  const dark = themePref === "system" ? systemDark : themePref === "dark";

  useEffect(() => {
    api.systemInfo().then((info) => {
      setSys(info);
      if (info.elevated) getCurrentWindow().setTitle("fluent-menu (Administrator)").catch(() => {});
    });
    api.listLocations().then(setLocations);
    api
      .nilesoftDetect()
      .then(setNilesoft)
      .catch(() => setNilesoft(null));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.mica = String(!!sys?.mica);
    // Keep the Mica tint in step with the content theme.
    api.setWindowDark(dark).catch(() => {});
  }, [dark, sys?.mica]);

  const theme = useMemo(
    () => makeTheme(dark, sys?.accentColor ?? "#0078d4"),
    [dark, sys],
  );

  const go = (p: string) => {
    setPage(p);
    storageSet("fm.page", p);
  };

  const location = page.startsWith("loc:")
    ? locations.find((l) => l.id === page.slice(4))
    : undefined;

  const navItem = (
    id: string,
    label: string,
    icon: ReactElement,
    extra?: ReactElement,
  ) => (
    <button
      key={id}
      className={`nav-item${page === id ? " selected" : ""}`}
      onClick={() => go(id)}
      title={label}
    >
      {icon}
      <span className="label">{label}</span>
      {extra}
    </button>
  );

  return (
    // No className here: Fluent copies the provider's classes onto every portal
    // (menus, dialogs, toasts), so layout classes would turn each portal into a
    // full-window layer.
    <FluentProvider theme={theme} style={{ height: "100%", background: "transparent" }}>
      <AdminProvider elevated={!!sys?.elevated}>
        <ConfirmProvider>
          <div className="shell">
            <nav className="nav">
              <div className="nav-section">Menu locations</div>
              {locations.map((l) =>
                navItem(
                  `loc:${l.id}`,
                  l.label,
                  LOCATION_ICONS[l.id] ?? <LayerDiagonal20Regular />,
                ),
              )}
              <div className="nav-section">Tools</div>
              {navItem("templates", "Templates", <Sparkle20Regular />)}
              {nilesoft &&
                navItem(
                  "nilesoft",
                  "Nilesoft Shell",
                  <WindowWrench20Regular />,
                )}
              {navItem("backups", "Backups", <History20Regular />)}
              <div className="nav-spacer" />
              {navItem("settings", "Settings", <Settings20Regular />)}
            </nav>
            <main className="content">
              <div className="page">
                {nilesoft && !bannerDismissed && page !== "nilesoft" && (
                  <div className="page-inner">
                    <MessageBar
                      className="banner"
                      intent="success"
                      layout="multiline"
                    >
                      <MessageBarBody>
                        <MessageBarTitle>
                          Nilesoft Shell {nilesoft.version ?? ""} detected
                        </MessageBarTitle>
                        Your Explorer menu is driven by Nilesoft. fluent-menu
                        can edit its {nilesoft.files.length} config files
                        visually.
                      </MessageBarBody>
                      <MessageBarActions
                        containerAction={
                          <Button
                            appearance="transparent"
                            icon={<Dismiss20Regular />}
                            aria-label="Dismiss"
                            onClick={() => {
                              setBannerDismissed(true);
                              storageSet("fm.nilesoftBanner", "dismissed");
                            }}
                          />
                        }
                      >
                        <Button onClick={() => go("nilesoft")}>
                          Open Nilesoft editor
                        </Button>
                      </MessageBarActions>
                    </MessageBar>
                  </div>
                )}
                {location && (
                  <LocationPage
                    key={location.id}
                    location={location}
                    elevated={!!sys?.elevated}
                  />
                )}
                {page === "templates" && (
                  <TemplatesPage locations={locations} />
                )}
                {page === "nilesoft" && nilesoft && (
                  <NilesoftPage info={nilesoft} />
                )}
                {page === "backups" && sys && (
                  <BackupsPage backupsDir={sys.backupsDir} />
                )}
                {page === "settings" && (
                  <SettingsPage
                    themePref={themePref}
                    onThemePref={(t) => {
                      setThemePref(t);
                      storageSet("fm.theme", t);
                    }}
                    elevated={!!sys?.elevated}
                  />
                )}
              </div>
            </main>
          </div>
          <Toaster toasterId={TOASTER_ID} position="bottom-end" />
        </ConfirmProvider>
      </AdminProvider>
    </FluentProvider>
  );
}
