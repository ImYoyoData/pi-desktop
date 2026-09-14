/**
 * App-wide "answer in which language" setting (main process).
 *
 * Stored in `userData/response-language.json` alongside the other app-level
 * settings (proxy.json, models-selection.json). Read once per agent worker start
 * and turned into a system-prompt instruction, so changing it applies to newly
 * started sessions.
 */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_RESPONSE_LANGUAGE_SETTINGS,
  parseResponseLanguageSettings,
  type ResponseLanguageSettings,
} from "../shared/response-language";

function settingsPath(): string {
  return path.join(app.getPath("userData"), "response-language.json");
}

export function getResponseLanguageSettings(): ResponseLanguageSettings {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return parseResponseLanguageSettings(raw);
  } catch {
    return { ...DEFAULT_RESPONSE_LANGUAGE_SETTINGS };
  }
}

export function setResponseLanguageSettings(next: unknown): ResponseLanguageSettings {
  const sanitized = parseResponseLanguageSettings(next);
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(sanitized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
  return sanitized;
}
