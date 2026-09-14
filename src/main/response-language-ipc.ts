/**
 * IPC for the "answer in which language" setting.
 *
 * The renderer owns device-language detection (`navigator.language`), so it sends
 * that along when saving — otherwise a worker started later could only guess.
 */

import { ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import {
  RESPONSE_LANGUAGE_OPTIONS,
  resolveResponseLanguage,
  type ResponseLanguageState,
} from "../shared/response-language";
import { getResponseLanguageSettings, setResponseLanguageSettings } from "./response-language-host";

export type { ResponseLanguageState } from "../shared/response-language";

let lastDeviceLanguage = "";

export function setDeviceLanguage(tag: string): void {
  lastDeviceLanguage = String(tag ?? "").trim();
}

/** Device language last reported by the renderer ("" until it reports). */
export function getDeviceLanguage(): string {
  return lastDeviceLanguage;
}

function stateOf(): ResponseLanguageState {
  const settings = getResponseLanguageSettings();
  return {
    settings,
    options: [
      { value: "auto", label: "" },
      ...RESPONSE_LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.nativeName })),
    ],
    effective: resolveResponseLanguage(settings, lastDeviceLanguage),
    deviceLanguage: lastDeviceLanguage,
  };
}

export function registerResponseLanguageIpc(): void {
  ipcMain.handle(IpcChannels.responseLanguage.get, () => stateOf());

  ipcMain.handle(
    IpcChannels.responseLanguage.set,
    (_event, next: unknown, deviceLanguage?: unknown) => {
      if (typeof deviceLanguage === "string" && deviceLanguage.trim()) {
        setDeviceLanguage(deviceLanguage);
      }
      setResponseLanguageSettings(next);
      return stateOf();
    },
  );
}
