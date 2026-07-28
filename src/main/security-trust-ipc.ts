import { ipcMain } from "electron";
import { parseDesktopSecurity } from "../shared/desktop-security";
import { IpcChannels } from "../shared/protocol";
import {
  getDesktopSecuritySettings,
  setDesktopSecuritySettings,
} from "./desktop-security-host";
import {
  clearProjectTrust,
  listTrustedWorkspaces,
  resolveTrustState,
  setProjectTrust,
} from "./project-trust";
import type { SessionBroker } from "./session-broker";

export function registerSecurityTrustIpc(broker?: SessionBroker): void {
  ipcMain.handle(IpcChannels.trust.get, (_event, cwd: string) => {
    if (typeof cwd !== "string" || !cwd.trim()) {
      throw new Error("trust.get: cwd is required");
    }
    return resolveTrustState(cwd);
  });

  ipcMain.handle(IpcChannels.trust.set, async (_event, cwd: string, trusted: boolean) => {
    if (typeof cwd !== "string" || !cwd.trim()) {
      throw new Error("trust.set: cwd is required");
    }
    if (typeof trusted !== "boolean") {
      throw new Error("trust.set: trusted must be a boolean");
    }
    setProjectTrust(cwd, trusted);
    // Recreate workers so SettingsManager / projectTrusted takes effect.
    await broker?.restartWorkersForCwd(cwd);
  });

  ipcMain.handle(IpcChannels.trust.clear, async (_event, cwd: string) => {
    if (typeof cwd !== "string" || !cwd.trim()) {
      throw new Error("trust.clear: cwd is required");
    }
    clearProjectTrust(cwd);
    await broker?.restartWorkersForCwd(cwd);
  });

  ipcMain.handle(IpcChannels.trust.listTrusted, () => listTrustedWorkspaces());

  ipcMain.handle(IpcChannels.security.get, async () => getDesktopSecuritySettings());

  ipcMain.handle(IpcChannels.security.set, async (_event, next: unknown) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      throw new Error("security.set: settings object is required");
    }
    const sanitized = parseDesktopSecurity({ desktopSecurity: next });
    await setDesktopSecuritySettings(sanitized);
    await broker?.notifyWorkersReloadSecurity(sanitized);
  });
}
