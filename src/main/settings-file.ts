/**
 * ~/.pi/agent/settings.json 的串行读写。
 * 各设置组共用一把写锁：settings.json 是整文件读改写，两个队列会互相覆盖。
 */

import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";

/** pi 1.2.0 发布的配置 schema；写进文件后编辑器可校验与补全。 */
const SETTINGS_SCHEMA_URL = "https://pi.dev/schemas/settings.schema.json";

export function settingsPath(agentDirOverride?: string): string {
  return path.join(path.resolve(agentDirOverride ?? agentDir()), "settings.json");
}

/** $schema 置首；用户已写的字符串值不动，非字符串的旧值剔除。 */
function withSchema(root: Record<string, unknown>): Record<string, unknown> {
  if (typeof root.$schema === "string") return root;
  const { $schema: _stale, ...rest } = root;
  return { $schema: SETTINGS_SCHEMA_URL, ...rest };
}

export function readSettingsRoot(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 文件缺失或损坏 —— 视为空设置
  }
  return {};
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, filePath);
}

/** v1：串行读改写，并发写者按入队顺序落盘。 */
let writeQueue: Promise<void> = Promise.resolve();

/** 队列内合并 patch 到 settings.json，保留其它键。 */
export function updateSettingsRoot(
  patch: Record<string, unknown>,
  agentDirOverride?: string,
): Promise<void> {
  const filePath = settingsPath(agentDirOverride);
  const task = (): void => {
    writeJsonAtomic(filePath, withSchema({ ...readSettingsRoot(filePath), ...patch }));
  };
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}
