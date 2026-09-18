/** 「流式渲染」设置的读写（~/.pi/agent/stream-render.json）；纯 fs，供主进程与会话 broker 共用。 */

import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import {
  DEFAULT_STREAM_RENDER_SETTINGS,
  parseStreamRenderSettings,
  type StreamRenderSettings,
} from "../shared/stream-render";

function storePath(): string {
  return path.join(agentDir(), "stream-render.json");
}

export function getStreamRenderSettings(): StreamRenderSettings {
  try {
    return parseStreamRenderSettings(JSON.parse(fs.readFileSync(storePath(), "utf8")));
  } catch {
    return { ...DEFAULT_STREAM_RENDER_SETTINGS };
  }
}

export function setStreamRenderSettings(next: unknown): StreamRenderSettings {
  const parsed = parseStreamRenderSettings(next);
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
