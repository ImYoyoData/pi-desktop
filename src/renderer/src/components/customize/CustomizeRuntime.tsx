import { useEffect, useState, type ReactNode } from "react";
import { Input, InputNumber, Select } from "antd";
import {
  BRANCH_SUMMARY_RESERVE_CHOICES,
  CACHE_WARMING_MODES,
  COMPACTION_KEEP_RECENT_CHOICES,
  COMPACTION_RESERVE_CHOICES,
  DELIVERY_MODES,
  TRANSPORT_MODES,
  WEBSOCKET_TIMEOUT_CHOICES,
  type CacheWarmingMode,
  type DeliveryMode,
  type RuntimeSettings,
  type RuntimeThinkingBudgets,
} from "../../../../shared/runtime-settings";
import { THINKING_LEVELS, isThinkingLevel } from "@renderer/utils/thinking-level";
import { useRuntimeSettingsStore } from "@renderer/stores/runtime-settings";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CustomizeRuntime.module.css";

type Option = { label: string; value: number | string };

/** NSelect 不能用 null 当值：-1 代表「不写该键」（用 pi 默认）。 */
const WS_TIMEOUT_DEFAULT = -1;

function tokenOptions(values: readonly number[]): Option[] {
  return values.map((value) => ({ label: value.toLocaleString(), value }));
}

/** 手写的非档位值也要能回显：并入选项，避免下拉把用户值显示成别的档位。 */
function withCurrent(options: Option[], current: number): Option[] {
  if (options.some((option) => option.value === current)) return options;
  return [...options, { label: current.toLocaleString(), value: current }].sort(
    (a, b) => Number(a.value) - Number(b.value),
  );
}

export function CustomizeRuntime(): ReactNode {
  const runtime = useRuntimeSettingsStore();
  const messageApi = useMessage();
  const t = useI18n();

  useEffect(() => {
    void runtime.load();
  }, []);

  const reserveOptions = withCurrent(
    tokenOptions(COMPACTION_RESERVE_CHOICES),
    runtime.settings.compaction.reserveTokens,
  );
  const keepRecentOptions = withCurrent(
    tokenOptions(COMPACTION_KEEP_RECENT_CHOICES),
    runtime.settings.compaction.keepRecentTokens,
  );
  const branchReserveOptions = withCurrent(
    tokenOptions(BRANCH_SUMMARY_RESERVE_CHOICES),
    runtime.settings.branchSummary.reserveTokens,
  );

  /** null = 不写键（pi 默认）；0 = 禁用连接超时（pi 的语义）。 */
  const wsTimeoutOptions: Option[] = [
    { label: t.runtimeWsTimeoutDefault, value: WS_TIMEOUT_DEFAULT },
    ...WEBSOCKET_TIMEOUT_CHOICES.map((value) => ({
      label: value === 0 ? t.runtimeWsTimeoutDisabled : t.retryDuration(value),
      value,
    })),
  ];
  const wsTimeoutValue = runtime.settings.websocketConnectTimeoutMs ?? WS_TIMEOUT_DEFAULT;

  const warmingLabel: Record<CacheWarmingMode, string> = {
    off: t.runtimeCacheWarmingOff,
    streaming: t.runtimeCacheWarmingStreaming,
    idle: t.runtimeCacheWarmingIdle,
  };

  const warmingOptions: Option[] = CACHE_WARMING_MODES.map((mode) => ({
    label: warmingLabel[mode],
    value: mode,
  }));

  /** 文本设置逐字符写盘太吵：本地编辑，失焦时保存。 */
  const [sessionDir, setSessionDir] = useState("");
  const [shellPath, setShellPath] = useState("");
  const [shellCommandPrefix, setShellCommandPrefix] = useState("");
  const [modelThinkingLevelsText, setModelThinkingLevelsText] = useState("");
  const [enabledModelsText, setEnabledModelsText] = useState("");
  const [npmCommandText, setNpmCommandText] = useState("");

  useEffect(() => {
    const settings = runtime.settings;
    setSessionDir(settings.sessionDir);
    setShellPath(settings.shellPath);
    setShellCommandPrefix(settings.shellCommandPrefix);
    setModelThinkingLevelsText(
      Object.entries(settings.modelThinkingLevels)
        .map(([key, level]) => `${key}: ${level}`)
        .join("\n"),
    );
    setEnabledModelsText(settings.enabledModels.join("\n"));
    setNpmCommandText(settings.npmCommand.join("\n"));
  }, [runtime.settings]);

  const thinkingLevelOptions: Option[] = [
    { label: t.runtimeLevelDefault, value: "" },
    ...THINKING_LEVELS.map((level) => ({ label: level.label, value: level.value })),
  ];

  const transportOptions: Option[] = [
    { label: t.runtimeTransportDefault, value: "" },
    ...TRANSPORT_MODES.map((mode) => ({ label: mode, value: mode })),
  ];

  const deliveryOptions: Option[] = DELIVERY_MODES.map((mode) => ({
    label: mode === "all" ? t.runtimeDeliveryAll : t.runtimeDeliveryOneAtATime,
    value: mode,
  }));

  function parseLevelMapText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const index = trimmed.indexOf(":");
      if (index <= 0) throw new Error(t.runtimeModelThinkingLevelsInvalid);
      const value = trimmed.slice(index + 1).trim();
      if (!isThinkingLevel(value)) throw new Error(t.runtimeModelThinkingLevelsInvalid);
      out[trimmed.slice(0, index).trim()] = value;
    }
    return out;
  }

  function parseLines(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /** 失焦保存的文本设置：解析失败提示原因并回读，避免界面与 settings.json 脱节。 */
  function saveModelThinkingLevels(): void {
    try {
      save({ modelThinkingLevels: parseLevelMapText(modelThinkingLevelsText) });
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : String(err));
      void runtime.load(true);
    }
  }

  function saveEnabledModels(): void {
    save({ enabledModels: parseLines(enabledModelsText) });
  }

  function saveNpmCommand(): void {
    save({ npmCommand: parseLines(npmCommandText) });
  }

  function save(patch: Partial<RuntimeSettings>): void {
    void saveSettings({ ...runtime.settings, ...patch });
  }

  /** 保存失败要看得见：提示原因并回读磁盘，避免界面显示与 pi 实际行为不一致。 */
  async function saveSettings(next: RuntimeSettings): Promise<void> {
    try {
      await runtime.save(next);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : String(err));
      await runtime.load(true);
    }
  }

  function saveCompaction(patch: Partial<RuntimeSettings["compaction"]>): void {
    save({ compaction: { ...runtime.settings.compaction, ...patch } });
  }

  function saveImages(patch: Partial<RuntimeSettings["images"]>): void {
    save({ images: { ...runtime.settings.images, ...patch } });
  }

  function saveBranch(patch: Partial<RuntimeSettings["branchSummary"]>): void {
    save({ branchSummary: { ...runtime.settings.branchSummary, ...patch } });
  }

  function saveBudget(level: keyof RuntimeThinkingBudgets, value: number | null): void {
    const next: RuntimeThinkingBudgets = { ...runtime.settings.thinkingBudgets };
    if (value === null || Number.isNaN(value)) delete next[level];
    else next[level] = value;
    save({ thinkingBudgets: next });
  }

  function onNumber(apply: (value: number) => void) {
    return (value: string | number | null): void => {
      if (typeof value === "number") apply(value);
    };
  }

  const onReserve = onNumber((value) => saveCompaction({ reserveTokens: value }));
  const onKeepRecent = onNumber((value) => saveCompaction({ keepRecentTokens: value }));
  const onBranchReserve = onNumber((value) => saveBranch({ reserveTokens: value }));

  function onWsTimeout(value: string | number): void {
    if (typeof value !== "number") return;
    save({ websocketConnectTimeoutMs: value === WS_TIMEOUT_DEFAULT ? null : value });
  }

  function onCacheWarming(value: string | number): void {
    if (typeof value === "string") save({ cacheWarming: value as CacheWarmingMode });
  }

  return (
    <div className={styles.runtimeSettings}>
      <SettingsGroup title={t.runtimeCompactionSection} hint={t.runtimeCompactionSectionHint}>
        <SettingsRow label={t.runtimeCompactionEnabled}>
          <SettingsSwitch
            checked={runtime.settings.compaction.enabled}
            label={t.runtimeCompactionEnabled}
            onChange={(value) => saveCompaction({ enabled: value })}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeCompactionReserve}
          description={t.runtimeCompactionReserveHint}
        >
          <Select
            value={runtime.settings.compaction.reserveTokens}
            options={reserveOptions}
            disabled={!runtime.settings.compaction.enabled}
            size="small"
            className={styles.settingSelect}
            onChange={onReserve}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeCompactionKeepRecent}
          description={t.runtimeCompactionKeepRecentHint}
        >
          <Select
            value={runtime.settings.compaction.keepRecentTokens}
            options={keepRecentOptions}
            disabled={!runtime.settings.compaction.enabled}
            size="small"
            className={styles.settingSelect}
            onChange={onKeepRecent}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeCacheSection} hint={t.runtimeCacheSectionHint}>
        <SettingsRow label={t.runtimeCacheWarming} description={t.runtimeCacheWarmingHint}>
          <Select
            value={runtime.settings.cacheWarming}
            options={warmingOptions}
            size="small"
            className={styles.settingSelect}
            onChange={onCacheWarming}
          />
        </SettingsRow>

        <SettingsRow label={t.runtimeCacheMissNotices} description={t.runtimeCacheMissNoticesHint}>
          <SettingsSwitch
            checked={runtime.settings.showCacheMissNotices}
            label={t.runtimeCacheMissNotices}
            onChange={(value) => save({ showCacheMissNotices: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeImagesSection} hint={t.runtimeImagesSectionHint}>
        <SettingsRow label={t.runtimeImageAutoResize} description={t.runtimeImageAutoResizeHint}>
          <SettingsSwitch
            checked={runtime.settings.images.autoResize}
            label={t.runtimeImageAutoResize}
            onChange={(value) => saveImages({ autoResize: value })}
          />
        </SettingsRow>

        <SettingsRow label={t.runtimeImageBlock} description={t.runtimeImageBlockHint}>
          <SettingsSwitch
            checked={runtime.settings.images.blockImages}
            label={t.runtimeImageBlock}
            onChange={(value) => saveImages({ blockImages: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeThinkingSection} hint={t.runtimeThinkingSectionHint}>
        <SettingsRow
          label={t.runtimeDefaultThinkingLevel}
          description={t.runtimeDefaultThinkingLevelHint}
        >
          <Select
            value={runtime.settings.defaultThinkingLevel}
            options={thinkingLevelOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value: string) => save({ defaultThinkingLevel: value })}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeModelThinkingLevels}
          description={t.runtimeModelThinkingLevelsHint}
        >
          <Input.TextArea
            value={modelThinkingLevelsText}
            size="small"
            className={styles.settingInput}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="provider/modelId: high"
            onChange={(event) => setModelThinkingLevelsText(event.target.value)}
            onBlur={saveModelThinkingLevels}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeEnabledModels}
          description={t.runtimeEnabledModelsHint}
        >
          <Input.TextArea
            value={enabledModelsText}
            size="small"
            className={styles.settingInput}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="anthropic/*"
            onChange={(event) => setEnabledModelsText(event.target.value)}
            onBlur={saveEnabledModels}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeHideThinkingBlock}
          description={t.runtimeHideThinkingBlockHint}
        >
          <SettingsSwitch
            checked={runtime.settings.hideThinkingBlock}
            label={t.runtimeHideThinkingBlock}
            onChange={(value) => save({ hideThinkingBlock: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeBudgetsSection} hint={t.runtimeBudgetsSectionHint}>
        <SettingsRow label="minimal">
          <InputNumber
            className={styles.settingSelect}
            size="small"
            value={runtime.settings.thinkingBudgets.minimal ?? null}
            min={1}
            controls={false}
            placeholder={t.runtimeBudgetPlaceholder}
            onChange={(value: number | null) => saveBudget("minimal", value)}
          />
        </SettingsRow>

        <SettingsRow label="low">
          <InputNumber
            className={styles.settingSelect}
            size="small"
            value={runtime.settings.thinkingBudgets.low ?? null}
            min={1}
            controls={false}
            placeholder={t.runtimeBudgetPlaceholder}
            onChange={(value: number | null) => saveBudget("low", value)}
          />
        </SettingsRow>

        <SettingsRow label="medium">
          <InputNumber
            className={styles.settingSelect}
            size="small"
            value={runtime.settings.thinkingBudgets.medium ?? null}
            min={1}
            controls={false}
            placeholder={t.runtimeBudgetPlaceholder}
            onChange={(value: number | null) => saveBudget("medium", value)}
          />
        </SettingsRow>

        <SettingsRow label="high">
          <InputNumber
            className={styles.settingSelect}
            size="small"
            value={runtime.settings.thinkingBudgets.high ?? null}
            min={1}
            controls={false}
            placeholder={t.runtimeBudgetPlaceholder}
            onChange={(value: number | null) => saveBudget("high", value)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeBranchSection} hint={t.runtimeBranchSectionHint}>
        <SettingsRow
          label={t.runtimeBranchReserve}
          description={t.runtimeBranchReserveHint}
        >
          <Select
            value={runtime.settings.branchSummary.reserveTokens}
            options={branchReserveOptions}
            size="small"
            className={styles.settingSelect}
            onChange={onBranchReserve}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeBranchSkipPrompt}
          description={t.runtimeBranchSkipPromptHint}
        >
          <SettingsSwitch
            checked={runtime.settings.branchSummary.skipPrompt}
            label={t.runtimeBranchSkipPrompt}
            onChange={(value) => saveBranch({ skipPrompt: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeDeliverySection} hint={t.runtimeDeliverySectionHint}>
        <SettingsRow label={t.runtimeSteeringMode} description={t.runtimeSteeringModeHint}>
          <Select
            value={runtime.settings.steeringMode}
            options={deliveryOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value: DeliveryMode) => save({ steeringMode: value })}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeFollowUpMode}
          description={t.runtimeFollowUpModeHint}
        >
          <Select
            value={runtime.settings.followUpMode}
            options={deliveryOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value: DeliveryMode) => save({ followUpMode: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeEnvSection} hint={t.runtimeEnvSectionHint}>
        <SettingsRow label={t.runtimeSessionDir} description={t.runtimeSessionDirHint}>
          <Input
            value={sessionDir}
            size="small"
            className={styles.settingInput}
            placeholder={t.runtimeSessionDirPlaceholder}
            onChange={(event) => setSessionDir(event.target.value)}
            onBlur={() => save({ sessionDir })}
          />
        </SettingsRow>

        <SettingsRow label={t.runtimeShellPath} description={t.runtimeShellPathHint}>
          <Input
            value={shellPath}
            size="small"
            className={styles.settingInput}
            placeholder={t.runtimeShellPathPlaceholder}
            onChange={(event) => setShellPath(event.target.value)}
            onBlur={() => save({ shellPath })}
          />
        </SettingsRow>

        <SettingsRow label={t.runtimeShellPrefix} description={t.runtimeShellPrefixHint}>
          <Input
            value={shellCommandPrefix}
            size="small"
            className={styles.settingInput}
            placeholder={t.runtimeShellPrefixPlaceholder}
            onChange={(event) => setShellCommandPrefix(event.target.value)}
            onBlur={() => save({ shellCommandPrefix })}
          />
        </SettingsRow>

        <SettingsRow label={t.runtimeTransport} description={t.runtimeTransportHint}>
          <Select
            value={runtime.settings.transport}
            options={transportOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value: string) => save({ transport: value })}
          />
        </SettingsRow>

        <SettingsRow label={t.runtimeNpmCommand} description={t.runtimeNpmCommandHint}>
          <Input.TextArea
            value={npmCommandText}
            size="small"
            className={styles.settingInput}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="npm"
            onChange={(event) => setNpmCommandText(event.target.value)}
            onBlur={saveNpmCommand}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimeAdvancedSection} hint={t.runtimeAdvancedSectionHint}>
        <SettingsRow
          label={t.runtimeAnthropicExtraUsage}
          description={t.runtimeAnthropicExtraUsageHint}
        >
          <SettingsSwitch
            checked={runtime.settings.anthropicExtraUsage}
            label={t.runtimeAnthropicExtraUsage}
            onChange={(value) => save({ anthropicExtraUsage: value })}
          />
        </SettingsRow>

        <SettingsRow label={t.runtimeWsTimeout} description={t.runtimeWsTimeoutHint}>
          <Select
            value={wsTimeoutValue}
            options={wsTimeoutOptions}
            size="small"
            className={styles.settingSelect}
            onChange={onWsTimeout}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeSkillCommands}
          description={t.runtimeSkillCommandsHint}
        >
          <SettingsSwitch
            checked={runtime.settings.enableSkillCommands}
            label={t.runtimeSkillCommands}
            onChange={(value) => save({ enableSkillCommands: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.runtimePrivacySection} hint={t.runtimePrivacySectionHint}>
        <SettingsRow label={t.runtimeAnalytics} description={t.runtimeAnalyticsHint}>
          <SettingsSwitch
            checked={runtime.settings.enableAnalytics}
            label={t.runtimeAnalytics}
            onChange={(value) => save({ enableAnalytics: value })}
          />
        </SettingsRow>

        <SettingsRow
          label={t.runtimeInstallTelemetry}
          description={t.runtimeInstallTelemetryHint}
        >
          <SettingsSwitch
            checked={runtime.settings.enableInstallTelemetry}
            label={t.runtimeInstallTelemetry}
            onChange={(value) => save({ enableInstallTelemetry: value })}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default CustomizeRuntime;
