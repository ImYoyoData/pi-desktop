import { isThinkingLevel } from "./thinking-level";

/**
 * 「运行」设置（settings.json 的顶层键）：
 * compaction / cacheWarming / showCacheMissNotices / images / thinkingBudgets /
 * branchSummary / warnings / shellPath / shellCommandPrefix / sessionDir /
 * enableSkillCommands / websocketConnectTimeoutMs / enableAnalytics / enableInstallTelemetry。
 * 档位为 UI 预设值；解析时保留用户手写的合法值（只在缺失/非法时回落默认）。
 */

export const CACHE_WARMING_MODES = ["off", "streaming", "idle"] as const;
export type CacheWarmingMode = (typeof CACHE_WARMING_MODES)[number];

/** 引导 / 追问队列的投递方式。 */
export const DELIVERY_MODES = ["all", "one-at-a-time"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** provider 传输方式（pi 的 transport）。 */
export const TRANSPORT_MODES = ["auto", "sse", "websocket", "websocket-cached"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/** 单个模型的压缩覆盖；键为 pi 的 `provider/modelId`，字段各自回退到全局值。 */
export type CompactionModelOverride = {
  reserveTokens?: number;
  keepRecentTokens?: number;
};

export type RuntimeCompactionSettings = {
  enabled: boolean;
  /** 压缩前为回复预留的 token（pi 默认 16384）。 */
  reserveTokens: number;
  /** 压缩后保留的最近 token（pi 默认 20000）。 */
  keepRecentTokens: number;
  /** 按模型覆盖压缩预算（pi 的 compaction.modelOverrides）；空对象表示不写该键。 */
  modelOverrides: Record<string, CompactionModelOverride>;
};

export type RuntimeImagesSettings = {
  /** pi 自动缩放附件、read 与工具结果图片（默认开）。 */
  autoResize: boolean;
  /** 屏蔽图片输入（默认关）。 */
  blockImages: boolean;
};

/** 各思考档位的 token 预算；未填写的档位用 pi 默认值。 */
export type RuntimeThinkingBudgets = {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
};

export type RuntimeBranchSummarySettings = {
  /** 分支摘要为输出预留的 token（pi 默认 16384）。 */
  reserveTokens: number;
  /** 切换分支时跳过「是否摘要」询问。 */
  skipPrompt: boolean;
};

export type RuntimeSettings = {
  compaction: RuntimeCompactionSettings;
  cacheWarming: CacheWarmingMode;
  showCacheMissNotices: boolean;
  images: RuntimeImagesSettings;
  thinkingBudgets: RuntimeThinkingBudgets;
  branchSummary: RuntimeBranchSummarySettings;
  /** Anthropic 订阅额度提示，pi 默认开启。 */
  anthropicExtraUsage: boolean;
  /** 启动思考档；空字符串表示不写（pi 默认 medium）。 */
  defaultThinkingLevel: string;
  /** 按模型的启动思考档，键为 pi 的 `provider/modelId`。 */
  modelThinkingLevels: Record<string, string>;
  /** 模型启用/循环 pattern（--models 格式）；空数组表示不写（全部可用模型）。 */
  enabledModels: string[];
  /** 隐藏思考块（pi 的 hideThinkingBlock）。 */
  hideThinkingBlock: boolean;
  /** 引导消息投递方式（pi 的 steeringMode）。 */
  steeringMode: DeliveryMode;
  /** 追问消息投递方式（pi 的 followUpMode）。 */
  followUpMode: DeliveryMode;
  /** provider 传输方式；空字符串表示不写（pi 默认 auto）。 */
  transport: string;
  /** npm 命令与参数（pi 的 npmCommand）；空数组表示不写（pi 默认 npm）。 */
  npmCommand: string[];
  /** Codex WebSocket 连接超时；null = 不写该键（pi 默认），0 = 禁用超时。 */
  websocketConnectTimeoutMs: number | null;
  /** 命令 shell 路径；空字符串表示自动探测。 */
  shellPath: string;
  /** 每条命令前执行的 shell 片段；空字符串表示不添加。 */
  shellCommandPrefix: string;
  /** 会话文件目录；空字符串表示 pi 的默认目录。 */
  sessionDir: string;
  /**
   * 允许 pi CLI 的技能斜杠命令（/skill: 补全）；
   * AgentSession 的 /skill: 展开与桌面聊天不受影响。
   */
  enableSkillCommands: boolean;
  enableAnalytics: boolean;
  enableInstallTelemetry: boolean;
};

export const COMPACTION_RESERVE_CHOICES = [
  4096, 8192, 12288, 16384, 24576, 32768, 65536,
  100000, 150000, 200000, 300000, 400000, 500000,
] as const;

export const COMPACTION_KEEP_RECENT_CHOICES = [
  5000, 10000, 15000, 20000, 30000, 60000, 100000, 150000, 200000,
] as const;

export const BRANCH_SUMMARY_RESERVE_CHOICES = [
  4096, 8192, 12288, 16384, 24576, 32768, 65536,
] as const;

/** websocketConnectTimeoutMs 的档位；0 在 pi 里表示禁用连接超时。 */
export const WEBSOCKET_TIMEOUT_CHOICES = [
  0, 10_000, 20_000, 30_000, 60_000, 120_000,
] as const;

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
    modelOverrides: {},
  },
  cacheWarming: "streaming",
  showCacheMissNotices: false,
  images: { autoResize: true, blockImages: false },
  thinkingBudgets: {},
  branchSummary: { reserveTokens: 16384, skipPrompt: false },
  anthropicExtraUsage: true,
  defaultThinkingLevel: "",
  modelThinkingLevels: {},
  enabledModels: [],
  hideThinkingBlock: false,
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  transport: "",
  npmCommand: [],
  websocketConnectTimeoutMs: null,
  shellPath: "",
  shellCommandPrefix: "",
  sessionDir: "",
  enableSkillCommands: true,
  enableAnalytics: false,
  enableInstallTelemetry: true,
};

function readObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function readPositiveNumber(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

/** pi 的 parseHttpIdleTimeoutMs 语义：0 = 禁用超时；缺失/非法 = 跟随 pi 默认。 */
function readWebsocketTimeout(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function readText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** 可选 token 预算：正整数才保留，其余视为未填写。 */
function readBudget(raw: unknown): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

/**
 * 读取 compaction.modelOverrides：值为对象的条目保留（空对象也保留，
 * 表示该模型启用了覆盖但字段仍走全局值）；非法条目丢弃，避免 pi 读取时报错。
 */
function readModelOverrides(raw: unknown): Record<string, CompactionModelOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CompactionModelOverride> = {};
  for (const [rawKey, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const override: CompactionModelOverride = {};
    const reserveTokens = readBudget(entry.reserveTokens);
    if (reserveTokens !== undefined) override.reserveTokens = reserveTokens;
    const keepRecentTokens = readBudget(entry.keepRecentTokens);
    if (keepRecentTokens !== undefined) override.keepRecentTokens = keepRecentTokens;
    out[key] = override;
  }
  return out;
}

/** 序列化 modelOverrides：只写 pi 支持的两个字段，其它键不落盘。 */
function writeModelOverrides(
  overrides: Record<string, CompactionModelOverride>,
): Record<string, CompactionModelOverride> | undefined {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return undefined;
  const out: Record<string, CompactionModelOverride> = {};
  for (const key of keys) {
    const override = overrides[key] ?? {};
    out[key] = {
      ...(typeof override.reserveTokens === "number"
        ? { reserveTokens: override.reserveTokens }
        : {}),
      ...(typeof override.keepRecentTokens === "number"
        ? { keepRecentTokens: override.keepRecentTokens }
        : {}),
    };
  }
  return out;
}

function isCacheWarmingMode(value: unknown): value is CacheWarmingMode {
  return (
    typeof value === "string" && (CACHE_WARMING_MODES as readonly string[]).includes(value)
  );
}

function isDeliveryMode(value: unknown): value is DeliveryMode {
  return typeof value === "string" && (DELIVERY_MODES as readonly string[]).includes(value);
}

function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === "string" && (TRANSPORT_MODES as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** 按模型思考档：键非空、值是合法档位才保留。 */
function readThinkingLevelMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key || !isThinkingLevel(value)) continue;
    out[key] = value;
  }
  return out;
}

/** 解析运行设置；缺省/非法值回落到 pi 的默认值。 */
export function parseRuntimeSettings(raw: unknown): RuntimeSettings {
  const source = readObject(raw);
  return parseRuntimeFields(source, readObject(source.warnings).anthropicExtraUsage);
}

/**
 * 规范化渲染端传来的 RuntimeSettings（扁平形状）：
 * 与 settings.json 唯一不同的字段是 `anthropicExtraUsage`，它在文件里位于 `warnings` 下。
 */
export function sanitizeRuntimeSettings(raw: unknown): RuntimeSettings {
  const source = readObject(raw);
  return parseRuntimeFields(source, source.anthropicExtraUsage);
}

function parseRuntimeFields(
  source: Record<string, unknown>,
  anthropicExtraUsage: unknown,
): RuntimeSettings {
  const compaction = readObject(source.compaction);
  const images = readObject(source.images);
  const budgets = readObject(source.thinkingBudgets);
  const branchSummary = readObject(source.branchSummary);
  const thinkingBudgets: RuntimeThinkingBudgets = {};
  for (const level of ["minimal", "low", "medium", "high"] as const) {
    const value = readBudget(budgets[level]);
    if (value !== undefined) thinkingBudgets[level] = value;
  }
  return {
    compaction: {
      enabled: compaction.enabled !== false,
      reserveTokens: readPositiveNumber(
        compaction.reserveTokens,
        DEFAULT_RUNTIME_SETTINGS.compaction.reserveTokens,
      ),
      keepRecentTokens: readPositiveNumber(
        compaction.keepRecentTokens,
        DEFAULT_RUNTIME_SETTINGS.compaction.keepRecentTokens,
      ),
      modelOverrides: readModelOverrides(compaction.modelOverrides),
    },
    cacheWarming: isCacheWarmingMode(source.cacheWarming)
      ? source.cacheWarming
      : DEFAULT_RUNTIME_SETTINGS.cacheWarming,
    showCacheMissNotices: source.showCacheMissNotices === true,
    images: {
      autoResize: images.autoResize !== false,
      blockImages: images.blockImages === true,
    },
    thinkingBudgets,
    branchSummary: {
      reserveTokens: readPositiveNumber(
        branchSummary.reserveTokens,
        DEFAULT_RUNTIME_SETTINGS.branchSummary.reserveTokens,
      ),
      skipPrompt: branchSummary.skipPrompt === true,
    },
    anthropicExtraUsage: anthropicExtraUsage !== false,
    defaultThinkingLevel: isThinkingLevel(source.defaultThinkingLevel)
      ? source.defaultThinkingLevel
      : "",
    modelThinkingLevels: readThinkingLevelMap(source.modelThinkingLevels),
    enabledModels: isStringArray(source.enabledModels)
      ? source.enabledModels.map((entry) => entry.trim()).filter(Boolean)
      : [],
    hideThinkingBlock: source.hideThinkingBlock === true,
    steeringMode: isDeliveryMode(source.steeringMode)
      ? source.steeringMode
      : DEFAULT_RUNTIME_SETTINGS.steeringMode,
    followUpMode: isDeliveryMode(source.followUpMode)
      ? source.followUpMode
      : DEFAULT_RUNTIME_SETTINGS.followUpMode,
    transport: isTransportMode(source.transport) ? source.transport : "",
    npmCommand: isStringArray(source.npmCommand)
      ? source.npmCommand.filter((entry) => entry.trim())
      : [],
    websocketConnectTimeoutMs: readWebsocketTimeout(source.websocketConnectTimeoutMs),
    shellPath: readText(source.shellPath),
    shellCommandPrefix: readText(source.shellCommandPrefix),
    sessionDir: readText(source.sessionDir),
    enableSkillCommands: source.enableSkillCommands !== false,
    enableAnalytics: source.enableAnalytics === true,
    enableInstallTelemetry: source.enableInstallTelemetry !== false,
  };
}

/**
 * 只覆盖运行设置相关的键；compaction / warnings 等段里其它字段原样保留。
 * 空字符串表示删除该键（回到 pi 的默认行为）。
 */
export function runtimeSettingsPatch(
  raw: unknown,
  next: RuntimeSettings,
): Record<string, unknown> {
  const source = readObject(raw);
  const compaction = {
    ...readObject(source.compaction),
    enabled: next.compaction.enabled,
    reserveTokens: next.compaction.reserveTokens,
    keepRecentTokens: next.compaction.keepRecentTokens,
    modelOverrides: writeModelOverrides(next.compaction.modelOverrides),
  };
  const warnings = {
    ...readObject(source.warnings),
    anthropicExtraUsage: next.anthropicExtraUsage,
  };
  const budgets: Record<string, number> = {};
  for (const [level, value] of Object.entries(next.thinkingBudgets)) {
    if (typeof value === "number") budgets[level] = value;
  }
  return {
    compaction,
    cacheWarming: next.cacheWarming,
    showCacheMissNotices: next.showCacheMissNotices,
    images: { autoResize: next.images.autoResize, blockImages: next.images.blockImages },
    thinkingBudgets: Object.keys(budgets).length > 0 ? budgets : undefined,
    branchSummary: {
      reserveTokens: next.branchSummary.reserveTokens,
      skipPrompt: next.branchSummary.skipPrompt,
    },
    warnings,
    defaultThinkingLevel: next.defaultThinkingLevel || undefined,
    modelThinkingLevels:
      Object.keys(next.modelThinkingLevels).length > 0 ? next.modelThinkingLevels : undefined,
    enabledModels: next.enabledModels.length > 0 ? next.enabledModels : undefined,
    hideThinkingBlock: next.hideThinkingBlock || undefined,
    steeringMode: next.steeringMode,
    followUpMode: next.followUpMode,
    transport: next.transport || undefined,
    npmCommand: next.npmCommand.length > 0 ? next.npmCommand : undefined,
    websocketConnectTimeoutMs: next.websocketConnectTimeoutMs ?? undefined,
    shellPath: next.shellPath || undefined,
    shellCommandPrefix: next.shellCommandPrefix || undefined,
    sessionDir: next.sessionDir || undefined,
    enableSkillCommands: next.enableSkillCommands,
    enableAnalytics: next.enableAnalytics,
    enableInstallTelemetry: next.enableInstallTelemetry,
  };
}
