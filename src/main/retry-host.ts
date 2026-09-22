/** 重试设置的读写（~/.pi/agent/settings.json 的 retry 段）。 */

import { parseRetrySettings, type RetrySettings } from "../shared/retry-settings";
import { readSettingsRoot, settingsPath, updateSettingsRoot } from "./settings-file";

export function getRetrySettings(agentDirOverride?: string): RetrySettings {
  return parseRetrySettings(readSettingsRoot(settingsPath(agentDirOverride)).retry);
}

export async function setRetrySettings(
  next: unknown,
  agentDirOverride?: string,
): Promise<RetrySettings> {
  const sanitized = parseRetrySettings(next);
  await updateSettingsRoot({ retry: sanitized }, agentDirOverride);
  return sanitized;
}
