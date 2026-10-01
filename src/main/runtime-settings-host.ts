/** 「运行」设置的读写（settings.json 顶层键）。 */

import { randomUUID } from "node:crypto";
import {
  parseRuntimeSettings,
  runtimeSettingsPatch,
  sanitizeRuntimeSettings,
  type RuntimeSettings,
} from "../shared/runtime-settings";
import { readSettingsRoot, settingsPath, updateSettingsRoot } from "./settings-file";

export function getRuntimeSettings(agentDirOverride?: string): RuntimeSettings {
  return parseRuntimeSettings(readSettingsRoot(settingsPath(agentDirOverride)));
}

export async function setRuntimeSettings(
  next: unknown,
  agentDirOverride?: string,
): Promise<RuntimeSettings> {
  const filePath = settingsPath(agentDirOverride);
  const raw = readSettingsRoot(filePath);
  const sanitized = sanitizeRuntimeSettings(next);
  const patch = runtimeSettingsPatch(raw, sanitized);
  // 与 pi 的启用行为一致：首次开启分析时生成跟踪 ID。
  if (sanitized.enableAnalytics && typeof raw.trackingId !== "string") {
    patch.trackingId = randomUUID();
  }
  await updateSettingsRoot(patch, agentDirOverride);
  return parseRuntimeSettings(readSettingsRoot(filePath));
}
