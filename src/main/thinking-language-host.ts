/** 「思考语言」设置的读写（~/.pi/agent/thinking-language.json）；纯 fs，供主进程与会话 broker 共用。 */

import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import {
  DEFAULT_THINKING_LANGUAGE_SETTINGS,
  parseThinkingLanguageSettings,
  type ThinkingLanguageSettings,
} from "../shared/thinking-language";

function storePath(): string {
  return path.join(agentDir(), "thinking-language.json");
}

export function getThinkingLanguageSettings(): ThinkingLanguageSettings {
  try {
    return parseThinkingLanguageSettings(
      JSON.parse(fs.readFileSync(storePath(), "utf8")),
    );
  } catch {
    return { ...DEFAULT_THINKING_LANGUAGE_SETTINGS };
  }
}

export function setThinkingLanguageSettings(next: unknown): ThinkingLanguageSettings {
  const parsed = parseThinkingLanguageSettings(next);
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
  return parsed;
}
