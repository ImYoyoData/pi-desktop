/** 「流式渲染」设置 IPC。 */

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
  getStreamRenderSettings,
  setStreamRenderSettings,
} from "./stream-render-host";
import type { SessionBroker } from "./session-broker";

export function registerStreamRenderIpc(broker?: SessionBroker): void {
  ipcMain.handle(IpcChannels.streamRender.get, () => getStreamRenderSettings());

  ipcMain.handle(IpcChannels.streamRender.set, async (_event, next: unknown) => {
    const saved = setStreamRenderSettings(next);
    await broker?.notifyWorkersReloadStreamRender(saved);
    return saved;
  });
}
