import { Button, Dropdown, Link, Option } from "@fluentui/react-components";
import {
  ArrowClockwise20Regular,
  DarkTheme20Regular,
  Info20Regular,
  ShieldKeyhole20Regular,
} from "@fluentui/react-icons";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useNotify } from "../ui";

export type ThemePref = "system" | "light" | "dark";

export function SettingsPage({
  themePref,
  onThemePref,
  elevated,
}: {
  themePref: ThemePref;
  onThemePref: (t: ThemePref) => void;
  elevated: boolean;
}) {
  const notify = useNotify();
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const labels: Record<ThemePref, string> = { system: "Use system setting", light: "Light", dark: "Dark" };

  return (
    <div className="page-inner">
      <div className="page-header">
        <div className="grow">
          <h1>Settings</h1>
        </div>
      </div>
      <div className="cards">
        <div className="card">
          <span className="entry-icon">
            <DarkTheme20Regular />
          </span>
          <div className="card-main">
            <div className="card-title">App theme</div>
            <div className="card-sub">Choose how fluent-menu looks</div>
          </div>
          <Dropdown
            value={labels[themePref]}
            selectedOptions={[themePref]}
            onOptionSelect={(_, d) => onThemePref(d.optionValue as ThemePref)}
            style={{ minWidth: 200 }}
          >
            {(Object.keys(labels) as ThemePref[]).map((k) => (
              <Option key={k} value={k}>
                {labels[k]}
              </Option>
            ))}
          </Dropdown>
        </div>

        <div className="card">
          <span className="entry-icon">
            <ShieldKeyhole20Regular />
          </span>
          <div className="card-main">
            <div className="card-title">Administrator mode</div>
            <div className="card-sub">
              {elevated
                ? "Running as administrator. All-users entries and shell extensions change without prompts."
                : "Changes to all-users entries and shell extensions ask for permission each time. Restart as administrator to skip the prompts."}
            </div>
          </div>
          {!elevated && (
            <Button onClick={() => api.restartAsAdmin().catch((e) => notify.error("Couldn't restart", e))}>Restart as administrator</Button>
          )}
        </div>

        <div className="card">
          <span className="entry-icon">
            <ArrowClockwise20Regular />
          </span>
          <div className="card-main">
            <div className="card-title">Restart Explorer</div>
            <div className="card-sub">Shell extension changes only apply after Explorer restarts. Open File Explorer windows will close.</div>
          </div>
          <Button onClick={() => api.restartExplorer().catch((e) => notify.error("Couldn't restart Explorer", e))}>Restart</Button>
        </div>

        <div className="card">
          <span className="entry-icon">
            <Info20Regular />
          </span>
          <div className="card-main">
            <div className="card-title">About fluent-menu</div>
            <div className="card-sub">
              Version {version} ·{" "}
              <Link onClick={() => openUrl("https://github.com/TriptoAfsin/fluent-menu")}>github.com/TriptoAfsin/fluent-menu</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
