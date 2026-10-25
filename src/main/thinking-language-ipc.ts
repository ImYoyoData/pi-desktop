/** 「思考语言」设置 IPC。 */

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
  getThinkingLanguageSettings,
  setThinkingLanguageSettings,
} from "./thinking-language-host";
import { broadcastStateChange } from "./ui-sync";

export function registerThinkingLanguageIpc(): void {
  ipcMain.handle(IpcChannels.thinkingLanguage.get, () => getThinkingLanguageSettings());

  ipcMain.handle(IpcChannels.thinkingLanguage.set, (_event, next: unknown) => {
    const saved = setThinkingLanguageSettings(next);
    broadcastStateChange({ scope: "thinkingLanguage", payload: saved });
    return saved;
  });
}
