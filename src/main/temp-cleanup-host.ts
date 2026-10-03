/** Pi 命令输出临时文件的定期清理（默认关闭，用户可在「设置 → 通用」开启）。 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentDir } from "./agent-dir";
import {
  DEFAULT_TEMP_CLEANUP_SETTINGS,
  parseTempCleanupSettings,
  PI_TEMP_PREFIXES,
  type TempCleanupSettings,
} from "../shared/temp-cleanup";

function storePath(): string {
  return path.join(agentDir(), "temp-cleanup.json");
}

export function getTempCleanupSettings(): TempCleanupSettings {
  try {
    return parseTempCleanupSettings(JSON.parse(fs.readFileSync(storePath(), "utf8")));
  } catch {
    return { ...DEFAULT_TEMP_CLEANUP_SETTINGS };
  }
}

export function setTempCleanupSettings(next: unknown): TempCleanupSettings {
  const parsed = parseTempCleanupSettings(next);
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

function isPiTempFile(name: string): boolean {
  return PI_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix) && name.endsWith(".log"));
}

/** 删除超过 maxAgeHours 的 Pi 临时输出，返回删除数量与释放的字节数。 */
export function sweepTempOutputs(maxAgeHours: number): { removed: number; bytes: number } {
  const dir = os.tmpdir();
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  let removed = 0;
  let bytes = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { removed, bytes };
  }
  for (const name of entries) {
    if (!isPiTempFile(name)) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      // mtime 太新的不动：可能正被某个会话中的模型读取。
      if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
      fs.unlinkSync(file);
      removed += 1;
      bytes += stat.size;
    } catch {
      // 文件可能刚被别人删掉，或没有权限
    }
  }
  return { removed, bytes };
}

let timer: ReturnType<typeof setInterval> | null = null;
let currentSettings: TempCleanupSettings = { ...DEFAULT_TEMP_CLEANUP_SETTINGS };

function runOnce(): void {
  if (!currentSettings.enabled) return;
  const { removed, bytes } = sweepTempOutputs(currentSettings.maxAgeHours);
  if (removed > 0) {
    console.info(
      `[temp-cleanup] removed ${removed} file(s), freed ${(bytes / 1024 / 1024).toFixed(1)}MB`,
    );
  }
}

function applyTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!currentSettings.enabled) return;
  const intervalMs = currentSettings.intervalHours * 3_600_000;
  timer = setInterval(runOnce, intervalMs);
  // 不因为定时器而阻止退出。
  timer.unref?.();
}

export function registerTempCleanup(): void {
  currentSettings = getTempCleanupSettings();
  applyTimer();
  if (currentSettings.enabled) {
    // 启动后稍等片刻再扫，避开刚启动的会话正在写的文件。
    const warmup = setTimeout(runOnce, 60_000);
    warmup.unref?.();
  }
}

export function applyTempCleanupSettings(next: unknown): TempCleanupSettings {
  currentSettings = setTempCleanupSettings(next);
  applyTimer();
  return currentSettings;
}
