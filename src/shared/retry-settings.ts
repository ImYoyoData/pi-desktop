/**
 * 重试设置（settings.json 的 retry 段）：
 * - enabled / maxRetries / baseDelayMs 由 pi SDK 的 turn 层自动重试读取；
 * - provider.* 由 pi SDK 的 HTTP 请求层读取；
 * - desktop.* 仅 pi-desktop 使用（worker 卡死自动恢复）。
 * 各档位为预设选项，解析时吸附到最近的档位，越界值不会写坏行为。
 */

export type RetryProviderSettings = {
  /** HTTP 层重试次数，0 = 不重试。 */
  maxRetries: number;
  /** 服务端要求的等待超过该值即直接失败，0 = 不限制。 */
  maxRetryDelayMs: number;
  /** 覆盖请求空闲超时；null 表示跟随 httpIdleTimeoutMs。 */
  timeoutMs: number | null;
};

export type RetryDesktopSettings = {
  /** worker 卡死 / stall 的自动恢复次数上限。 */
  recoverMax: number;
  /** 软挂起（无输出但心跳正常）的恢复次数上限。 */
  softHangMax: number;
  /** 无输出多久算软挂起（ms）。 */
  softHangSilenceMs: number;
  /** 输出与心跳同时静默多久算卡死（ms）。 */
  stallSilenceMs: number;
};

export type RetrySettings = {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  provider: RetryProviderSettings;
  desktop: RetryDesktopSettings;
};

export const RETRY_COUNT_CHOICES = [0, 1, 2, 3, 5, 8, 10] as const;
export const RETRY_BASE_DELAY_CHOICES = [500, 1000, 2000, 3000, 5000, 10_000] as const;
export const RETRY_MAX_DELAY_CHOICES = [0, 15_000, 30_000, 60_000, 120_000, 300_000] as const;
export const RETRY_TIMEOUT_CHOICES = [null, 60_000, 120_000, 300_000, 600_000] as const;
export const RETRY_DESKTOP_COUNT_CHOICES = [0, 1, 2, 3, 5] as const;
export const RETRY_SOFT_HANG_SILENCE_CHOICES = [60_000, 120_000, 180_000, 300_000] as const;
export const RETRY_STALL_SILENCE_CHOICES = [30_000, 45_000, 60_000, 75_000, 120_000] as const;

export const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  provider: { maxRetries: 0, maxRetryDelayMs: 60_000, timeoutMs: null },
  desktop: {
    recoverMax: 2,
    softHangMax: 1,
    softHangSilenceMs: 180_000,
    stallSilenceMs: 75_000,
  },
};

function readObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function snapToChoice(raw: unknown, choices: readonly number[], fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return choices.reduce(
    (best, choice) => (Math.abs(choice - value) < Math.abs(best - value) ? choice : best),
    fallback,
  );
}

function parseProvider(raw: unknown): RetryProviderSettings {
  const source = readObject(raw);
  const defaults = DEFAULT_RETRY_SETTINGS.provider;
  return {
    maxRetries: snapToChoice(source.maxRetries, RETRY_COUNT_CHOICES, defaults.maxRetries),
    maxRetryDelayMs: snapToChoice(
      source.maxRetryDelayMs,
      RETRY_MAX_DELAY_CHOICES,
      defaults.maxRetryDelayMs,
    ),
    timeoutMs:
      source.timeoutMs === null || source.timeoutMs === undefined
        ? null
        : snapToChoice(source.timeoutMs, RETRY_TIMEOUT_CHOICES.slice(1) as number[], 300_000),
  };
}

function parseDesktop(raw: unknown): RetryDesktopSettings {
  const source = readObject(raw);
  const defaults = DEFAULT_RETRY_SETTINGS.desktop;
  return {
    recoverMax: snapToChoice(source.recoverMax, RETRY_DESKTOP_COUNT_CHOICES, defaults.recoverMax),
    softHangMax: snapToChoice(source.softHangMax, RETRY_DESKTOP_COUNT_CHOICES, defaults.softHangMax),
    softHangSilenceMs: snapToChoice(
      source.softHangSilenceMs,
      RETRY_SOFT_HANG_SILENCE_CHOICES,
      defaults.softHangSilenceMs,
    ),
    stallSilenceMs: snapToChoice(
      source.stallSilenceMs,
      RETRY_STALL_SILENCE_CHOICES,
      defaults.stallSilenceMs,
    ),
  };
}

/** 解析 settings.json 的 retry 段，非法档位吸附到最近的合法值。 */
export function parseRetrySettings(raw: unknown): RetrySettings {
  const source = readObject(raw);
  return {
    enabled: source.enabled !== false,
    maxRetries: snapToChoice(source.maxRetries, RETRY_COUNT_CHOICES, DEFAULT_RETRY_SETTINGS.maxRetries),
    baseDelayMs: snapToChoice(
      source.baseDelayMs,
      RETRY_BASE_DELAY_CHOICES,
      DEFAULT_RETRY_SETTINGS.baseDelayMs,
    ),
    provider: parseProvider(source.provider),
    desktop: parseDesktop(source.desktop),
  };
}
