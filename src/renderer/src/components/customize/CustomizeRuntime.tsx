import { useEffect, type ReactNode } from "react";
import { Select } from "antd";
import {
  BRANCH_SUMMARY_RESERVE_CHOICES,
  CACHE_WARMING_MODES,
  COMPACTION_KEEP_RECENT_CHOICES,
  COMPACTION_RESERVE_CHOICES,
  DELIVERY_MODES,
  type CacheWarmingMode,
  type DeliveryMode,
  type RuntimeSettings,
} from "../../../../shared/runtime-settings";
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

  const warmingLabel: Record<CacheWarmingMode, string> = {
    off: t.runtimeCacheWarmingOff,
    streaming: t.runtimeCacheWarmingStreaming,
    idle: t.runtimeCacheWarmingIdle,
  };

  const warmingOptions: Option[] = CACHE_WARMING_MODES.map((mode) => ({
    label: warmingLabel[mode],
    value: mode,
  }));

  const deliveryOptions: Option[] = DELIVERY_MODES.map((mode) => ({
    label: mode === "all" ? t.runtimeDeliveryAll : t.runtimeDeliveryOneAtATime,
    value: mode,
  }));

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

  function onNumber(apply: (value: number) => void) {
    return (value: string | number | null): void => {
      if (typeof value === "number") apply(value);
    };
  }

  const onReserve = onNumber((value) => saveCompaction({ reserveTokens: value }));
  const onKeepRecent = onNumber((value) => saveCompaction({ keepRecentTokens: value }));
  const onBranchReserve = onNumber((value) => saveBranch({ reserveTokens: value }));

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
