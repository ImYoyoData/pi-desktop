import { ipcMain } from "electron";
import { parseDesktopSecurity } from "../shared/desktop-security";
import { IpcChannels } from "../shared/protocol";
import {
  getDesktopSecuritySettings,
  setDesktopSecuritySettings,
} from "./desktop-security-host";
import type { SessionBroker } from "./session-broker";

export function registerSecurityIpc(broker?: SessionBroker): void {
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
