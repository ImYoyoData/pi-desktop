/**
 * Pi 把超过 50KB / 2000 行的命令输出写进 %TEMP%/pi-bash-*.log 并把路径给模型，
 * 但从不删除；桌面是长驻应用，几个月就能攒出几个 GB。这里提供可开关的清理。
 */

/** 清理扫描的间隔档位（小时）。 */
export const TEMP_CLEANUP_INTERVALS = [1, 6, 12, 24, 72, 168] as const;

export type TempCleanupSettings = {
  /** 是否定期清理过期的命令输出临时文件。 */
  enabled: boolean;
  /** 清理间隔（小时）。 */
  intervalHours: number;
  /** 超过该时长的文件视为过期（小时）；0 表示只要过期于上次清理即删。 */
  maxAgeHours: number;
};

export const DEFAULT_TEMP_CLEANUP_SETTINGS: TempCleanupSettings = {
  enabled: false,
  intervalHours: 24,
  maxAgeHours: 24,
};

/** Pi 写出的命令输出临时文件前缀。 */
export const PI_TEMP_PREFIXES = ["pi-bash-", "pi-powershell-", "pi-output-"] as const;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parseTempCleanupSettings(raw: unknown): TempCleanupSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_TEMP_CLEANUP_SETTINGS };
  }
  const record = raw as Record<string, unknown>;
  const interval = num(record.intervalHours, DEFAULT_TEMP_CLEANUP_SETTINGS.intervalHours);
  return {
    enabled: record.enabled === true,
    intervalHours: TEMP_CLEANUP_INTERVALS.includes(
      interval as (typeof TEMP_CLEANUP_INTERVALS)[number],
    )
      ? interval
      : DEFAULT_TEMP_CLEANUP_SETTINGS.intervalHours,
    maxAgeHours: num(record.maxAgeHours, DEFAULT_TEMP_CLEANUP_SETTINGS.maxAgeHours),
  };
}
