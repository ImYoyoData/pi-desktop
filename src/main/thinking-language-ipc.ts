/** 「思考语言」设置 IPC。 */

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
  getThinkingLanguageSettings,
  setThinkingLanguageSettings,
} from "./thinking-language-host";

export function registerThinkingLanguageIpc(): void {
  ipcMain.handle(IpcChannels.thinkingLanguage.get, () => getThinkingLanguageSettings());

  ipcMain.handle(IpcChannels.thinkingLanguage.set, (_event, next: unknown) =>
    setThinkingLanguageSettings(next),
  );
}
