import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "antd";
import { SettingsGroup, SettingsRow } from "@renderer/components/customize/SettingsGroup";
import { useAppUpdateStore } from "@renderer/stores/app-update";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { SystemInfo } from "../../../../shared/api";
import styles from "./CustomizeDeveloper.module.css";

/** Windows build 号对应发布名，新版本在此补充。 */
const WINDOWS_RELEASES: [number, string][] = [
  [19044, "10 21H2"],
  [19045, "10 22H2"],
  [22000, "11 21H2"],
  [22621, "11 22H2"],
  [22631, "11 23H2"],
  [26100, "11 24H2"],
  [26200, "11 25H2"],
];

function windowsLabel(build: number): string {
  for (let i = WINDOWS_RELEASES.length - 1; i >= 0; i--) {
    const [minBuild, name] = WINDOWS_RELEASES[i];
    if (build >= minBuild) return `Windows ${name}`;
  }
  return "Windows";
}

/** 例：Windows 11 22H2 22621 x64 / macOS 14.5.0 arm64 / Linux 6.8.0 x64。 */
function systemLabel(info: SystemInfo): string {
  if (info.platform === "win32") {
    const build = Number(info.version.split(".").pop());
    return `${windowsLabel(build)} ${build} ${info.arch}`;
  }
  if (info.platform === "darwin") return `macOS ${info.version} ${info.arch}`;
  return `Linux ${info.release} ${info.arch}`;
}

export function CustomizeDeveloper(): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const forceUpdate = useAppUpdateStore((s) => s.forceUpdate);
  const [appVersion, setAppVersion] = useState("");
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [piSdkVersion, setPiSdkVersion] = useState<string | null>(null);
  const [piCli, setPiCli] = useState<{ installed: boolean; version: string | null } | null>(null);
  const versions = useMemo(() => ({ ...window.electron.process.versions }), []);

  useEffect(() => {
    void window.api.update
      .getAppInfo()
      .then((info) => setAppVersion(info.version))
      .catch(() => setAppVersion(""));
    void window.api.window
      .systemInfo()
      .then(setSystemInfo)
      .catch(() => setSystemInfo(null));
    void window.api.piCli
      .sdkVersion()
      .then(setPiSdkVersion)
      .catch(() => setPiSdkVersion(null));
    void window.api.piCli
      .status()
      .then((status) => setPiCli({ installed: status.installed, version: status.version }))
      .catch(() => setPiCli(null));
  }, []);

  async function onOpenDevTools(): Promise<void> {
    try {
      await window.api.window.openDevTools();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t.cannotOpenDevtools);
    }
  }

  /** 真实跑一遍自动更新：下载最新安装包，装好后程序会退出并交给安装器。 */
  function onTestUpdate(): void {
    void forceUpdate();
  }

  return (
    <div className={styles.customizeDeveloper}>
      <SettingsGroup title={t.developerRuntime}>
        <SettingsRow label={t.developerAppVersion}>
          <span className={styles.value}>{appVersion ? `v${appVersion}` : "—"}</span>
        </SettingsRow>
        <SettingsRow label={t.developerPiSdk}>
          <span className={styles.value}>{piSdkVersion ? `v${piSdkVersion}` : "—"}</span>
        </SettingsRow>
        <SettingsRow label={t.developerPiCli}>
          <span className={styles.value}>
            {!piCli
              ? "—"
              : piCli.installed
                ? piCli.version
                  ? `v${piCli.version}`
                  : t.developerPiCliUnknown
                : t.developerPiCliMissing}
          </span>
        </SettingsRow>
        <SettingsRow label={t.developerRuntimeVersions}>
          <span className={styles.value}>
            Electron {versions.electron ?? "—"} · Chromium {versions.chrome ?? "—"} · Node{" "}
            {versions.node ?? "—"}
          </span>
        </SettingsRow>
        <SettingsRow label={t.developerPlatform}>
          <span className={styles.value}>
            {systemInfo ? systemLabel(systemInfo) : "—"}
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.developerDebug}>
        <SettingsRow label={t.securityOpenDevTools}>
          <Button size="small" onClick={() => void onOpenDevTools()}>
            {t.open}
          </Button>
        </SettingsRow>
        <SettingsRow label={t.developerReload}>
          <Button size="small" onClick={() => window.location.reload()}>
            {t.developerReloadAction}
          </Button>
        </SettingsRow>
        <SettingsRow label={t.updateTestLabel}>
          <Button size="small" onClick={onTestUpdate}>
            {t.updateTestStart}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default CustomizeDeveloper;
