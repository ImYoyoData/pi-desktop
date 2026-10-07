<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  NButton,
  NDivider,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NText,
  useMessage,
} from "naive-ui";
import {
  BRANCH_SUMMARY_RESERVE_CHOICES,
  CACHE_WARMING_MODES,
  COMPACTION_KEEP_RECENT_CHOICES,
  COMPACTION_RESERVE_CHOICES,
  WEBSOCKET_TIMEOUT_CHOICES,
  type CacheWarmingMode,
  type CompactionModelOverride,
  type RuntimeSettings,
  type RuntimeThinkingBudgets,
} from "../../../../shared/runtime-settings";
import { useRuntimeSettingsStore } from "@renderer/stores/runtime-settings";
import { t } from "@renderer/i18n";

const runtime = useRuntimeSettingsStore();
const messageApi = useMessage();
void runtime.load();

type Option = { label: string; value: number | string };

/** NSelect 不能用 null 当值：-1 代表「不写该键」（用 pi 默认）。 */
const WS_TIMEOUT_DEFAULT = -1;

/** 按模型覆盖里的 -1：该字段不写，跟随上面的全局值。 */
const OVERRIDE_UNSET = -1;

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

const reserveOptions = computed(() =>
  withCurrent(
    tokenOptions(COMPACTION_RESERVE_CHOICES),
    runtime.settings.compaction.reserveTokens,
  ),
);
const keepRecentOptions = computed(() =>
  withCurrent(
    tokenOptions(COMPACTION_KEEP_RECENT_CHOICES),
    runtime.settings.compaction.keepRecentTokens,
  ),
);
const branchReserveOptions = computed(() =>
  withCurrent(
    tokenOptions(BRANCH_SUMMARY_RESERVE_CHOICES),
    runtime.settings.branchSummary.reserveTokens,
  ),
);

/** null = 不写键（pi 默认）；0 = 禁用连接超时（pi 的语义）。 */
const wsTimeoutOptions = computed<Option[]>(() => [
  { label: t.runtimeWsTimeoutDefault, value: WS_TIMEOUT_DEFAULT },
  ...WEBSOCKET_TIMEOUT_CHOICES.map((value) => ({
    label: value === 0 ? t.runtimeWsTimeoutDisabled : t.retryDuration(value),
    value,
  })),
]);
const wsTimeoutValue = computed(
  () => runtime.settings.websocketConnectTimeoutMs ?? WS_TIMEOUT_DEFAULT,
);

const warmingLabel: Record<CacheWarmingMode, string> = {
  off: t.runtimeCacheWarmingOff,
  streaming: t.runtimeCacheWarmingStreaming,
  idle: t.runtimeCacheWarmingIdle,
};

const warmingOptions = computed<Option[]>(() =>
  CACHE_WARMING_MODES.map((mode) => ({ label: warmingLabel[mode], value: mode })),
);

/** 文本设置逐字符写盘太吵：本地编辑，失焦时保存。 */
const sessionDir = ref("");
const shellPath = ref("");
const shellCommandPrefix = ref("");

watch(
  () => runtime.settings,
  (settings) => {
    sessionDir.value = settings.sessionDir;
    shellPath.value = settings.shellPath;
    shellCommandPrefix.value = settings.shellCommandPrefix;
  },
  { immediate: true, deep: true },
);

const compactionEnabled = computed({
  get: () => runtime.settings.compaction.enabled,
  set: (value: boolean) => saveCompaction({ enabled: value }),
});
const cacheMissNotices = computed({
  get: () => runtime.settings.showCacheMissNotices,
  set: (value: boolean) => save({ showCacheMissNotices: value }),
});
const autoResizeImages = computed({
  get: () => runtime.settings.images.autoResize,
  set: (value: boolean) => saveImages({ autoResize: value }),
});
const blockImages = computed({
  get: () => runtime.settings.images.blockImages,
  set: (value: boolean) => saveImages({ blockImages: value }),
});
const branchSkipPrompt = computed({
  get: () => runtime.settings.branchSummary.skipPrompt,
  set: (value: boolean) => saveBranch({ skipPrompt: value }),
});
const anthropicExtraUsage = computed({
  get: () => runtime.settings.anthropicExtraUsage,
  set: (value: boolean) => save({ anthropicExtraUsage: value }),
});
const skillCommands = computed({
  get: () => runtime.settings.enableSkillCommands,
  set: (value: boolean) => save({ enableSkillCommands: value }),
});
const analytics = computed({
  get: () => runtime.settings.enableAnalytics,
  set: (value: boolean) => save({ enableAnalytics: value }),
});
const installTelemetry = computed({
  get: () => runtime.settings.enableInstallTelemetry,
  set: (value: boolean) => save({ enableInstallTelemetry: value }),
});

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

type ModelChoice = { label: string; value: string; name: string };

const modelChoices = ref<ModelChoice[]>([]);
const overrideModelToAdd = ref<string | null>(null);

onMounted(async () => {
  try {
    const data = await window.api.models.get();
    modelChoices.value = data.available
      .map((model) => {
        const name = model.name?.trim() || model.id;
        return {
          label: `${name} · ${model.provider}/${model.id}`,
          value: `${model.provider}/${model.id}`,
          name,
        };
      })
      .sort((a, b) => a.value.localeCompare(b.value));
  } catch {
    // 拉取失败时仍可编辑/删除已存在的覆盖
  }
});

const overrideRows = computed(() =>
  Object.entries(runtime.settings.compaction.modelOverrides)
    .map(([key, override]) => {
      const choice = modelChoices.value.find((model) => model.value === key);
      return {
        key,
        label: choice?.name ?? key,
        reserveTokens: override.reserveTokens ?? OVERRIDE_UNSET,
        keepRecentTokens: override.keepRecentTokens ?? OVERRIDE_UNSET,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key)),
);

/** 下拉选项：-1 = 不设置（跟随全局），并把已写入的非档位值并进来回显。 */
function overrideTokenOptions(values: readonly number[], field: keyof CompactionModelOverride): Option[] {
  const current = Object.values(runtime.settings.compaction.modelOverrides)
    .map((override) => override[field])
    .filter((value): value is number => typeof value === "number");
  const nums = [...new Set([...values, ...current])].sort((a, b) => a - b);
  const global =
    field === "reserveTokens"
      ? runtime.settings.compaction.reserveTokens
      : runtime.settings.compaction.keepRecentTokens;
  return [
    {
      label: `${t.runtimeCompactionOverrideGlobal} (${global.toLocaleString()})`,
      value: OVERRIDE_UNSET,
    },
    ...nums.map((value) => ({ label: value.toLocaleString(), value })),
  ];
}

const reserveOverrideOptions = computed(() =>
  overrideTokenOptions(COMPACTION_RESERVE_CHOICES, "reserveTokens"),
);
const keepRecentOverrideOptions = computed(() =>
  overrideTokenOptions(COMPACTION_KEEP_RECENT_CHOICES, "keepRecentTokens"),
);

function addOverride(): void {
  const key = overrideModelToAdd.value;
  if (!key) return;
  if (!runtime.settings.compaction.modelOverrides[key]) {
    saveCompaction({ modelOverrides: { ...runtime.settings.compaction.modelOverrides, [key]: {} } });
  }
  overrideModelToAdd.value = null;
}

function removeOverride(key: string): void {
  const next = { ...runtime.settings.compaction.modelOverrides };
  delete next[key];
  saveCompaction({ modelOverrides: next });
}

function setOverrideField(
  key: string,
  field: keyof CompactionModelOverride,
  value: string | number,
): void {
  if (typeof value !== "number") return;
  const current = runtime.settings.compaction.modelOverrides;
  const entry: CompactionModelOverride = { ...current[key] };
  if (value === OVERRIDE_UNSET) delete entry[field];
  else entry[field] = value;
  saveCompaction({ modelOverrides: { ...current, [key]: entry } });
}
</script>

<template>
  <div class="runtime-settings">
    <div class="section-head">
      <NText strong>{{ t.runtimeCompactionSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeCompactionSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeCompactionEnabled }}</NText>
      </div>
      <NRadioGroup v-model:value="compactionEnabled" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeCompactionReserve }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeCompactionReserveHint }}</NText>
      </div>
      <NSelect
        :value="runtime.settings.compaction.reserveTokens"
        :options="reserveOptions"
        :disabled="!runtime.settings.compaction.enabled"
        size="small"
        class="setting-select"
        @update:value="onReserve"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeCompactionKeepRecent }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeCompactionKeepRecentHint }}</NText>
      </div>
      <NSelect
        :value="runtime.settings.compaction.keepRecentTokens"
        :options="keepRecentOptions"
        :disabled="!runtime.settings.compaction.enabled"
        size="small"
        class="setting-select"
        @update:value="onKeepRecent"
      />
    </div>

    <div class="section-head override-head">
      <NText strong>{{ t.runtimeCompactionOverrides }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeCompactionOverridesHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeCompactionOverrideModel }}</NText>
      </div>
      <div class="override-add">
        <NSelect
          v-model:value="overrideModelToAdd"
          :options="modelChoices"
          :disabled="!runtime.settings.compaction.enabled"
          filterable
          clearable
          size="small"
          class="override-model-select"
          :placeholder="t.runtimeCompactionOverrideModel"
        />
        <NButton
          size="small"
          :disabled="!runtime.settings.compaction.enabled || !overrideModelToAdd"
          @click="addOverride"
        >
          {{ t.runtimeCompactionOverrideAdd }}
        </NButton>
      </div>
    </div>

    <div v-if="overrideRows.length === 0" class="override-empty">
      <NText depth="3" class="row-hint">{{ t.runtimeCompactionOverridesEmpty }}</NText>
    </div>

    <div v-for="row in overrideRows" :key="row.key" class="switch-row override-row">
      <div class="switch-labels">
        <NText strong class="override-label">{{ row.label }}</NText>
        <NText depth="3" class="row-hint override-key">{{ row.key }}</NText>
      </div>
      <div class="override-controls">
        <NText depth="3" class="override-field-label">{{ t.runtimeCompactionReserve }}</NText>
        <NSelect
          :value="row.reserveTokens"
          :options="reserveOverrideOptions"
          :disabled="!runtime.settings.compaction.enabled"
          size="small"
          class="setting-select"
          @update:value="(value: string | number) => setOverrideField(row.key, 'reserveTokens', value)"
        />
        <NText depth="3" class="override-field-label">{{ t.runtimeCompactionKeepRecent }}</NText>
        <NSelect
          :value="row.keepRecentTokens"
          :options="keepRecentOverrideOptions"
          :disabled="!runtime.settings.compaction.enabled"
          size="small"
          class="setting-select"
          @update:value="(value: string | number) => setOverrideField(row.key, 'keepRecentTokens', value)"
        />
        <NButton size="small" quaternary @click="removeOverride(row.key)">
          {{ t.runtimeCompactionOverrideRemove }}
        </NButton>
      </div>
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.runtimeCacheSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeCacheSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeCacheWarming }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeCacheWarmingHint }}</NText>
      </div>
      <NSelect
        :value="runtime.settings.cacheWarming"
        :options="warmingOptions"
        size="small"
        class="setting-select"
        @update:value="onCacheWarming"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeCacheMissNotices }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeCacheMissNoticesHint }}</NText>
      </div>
      <NRadioGroup v-model:value="cacheMissNotices" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.runtimeImagesSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeImagesSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeImageAutoResize }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeImageAutoResizeHint }}</NText>
      </div>
      <NRadioGroup v-model:value="autoResizeImages" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeImageBlock }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeImageBlockHint }}</NText>
      </div>
      <NRadioGroup v-model:value="blockImages" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.runtimeBudgetsSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeBudgetsSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>minimal</NText>
      </div>
      <NInputNumber
        class="setting-select"
        size="small"
        :value="runtime.settings.thinkingBudgets.minimal ?? null"
        :min="1"
        :show-button="false"
        :placeholder="t.runtimeBudgetPlaceholder"
        @update:value="(value: number | null) => saveBudget('minimal', value)"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>low</NText>
      </div>
      <NInputNumber
        class="setting-select"
        size="small"
        :value="runtime.settings.thinkingBudgets.low ?? null"
        :min="1"
        :show-button="false"
        :placeholder="t.runtimeBudgetPlaceholder"
        @update:value="(value: number | null) => saveBudget('low', value)"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>medium</NText>
      </div>
      <NInputNumber
        class="setting-select"
        size="small"
        :value="runtime.settings.thinkingBudgets.medium ?? null"
        :min="1"
        :show-button="false"
        :placeholder="t.runtimeBudgetPlaceholder"
        @update:value="(value: number | null) => saveBudget('medium', value)"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>high</NText>
      </div>
      <NInputNumber
        class="setting-select"
        size="small"
        :value="runtime.settings.thinkingBudgets.high ?? null"
        :min="1"
        :show-button="false"
        :placeholder="t.runtimeBudgetPlaceholder"
        @update:value="(value: number | null) => saveBudget('high', value)"
      />
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.runtimeBranchSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeBranchSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeBranchReserve }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeBranchReserveHint }}</NText>
      </div>
      <NSelect
        :value="runtime.settings.branchSummary.reserveTokens"
        :options="branchReserveOptions"
        size="small"
        class="setting-select"
        @update:value="onBranchReserve"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeBranchSkipPrompt }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeBranchSkipPromptHint }}</NText>
      </div>
      <NRadioGroup v-model:value="branchSkipPrompt" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.runtimeEnvSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeEnvSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeSessionDir }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeSessionDirHint }}</NText>
      </div>
      <NInput
        v-model:value="sessionDir"
        size="small"
        class="setting-input"
        :placeholder="t.runtimeSessionDirPlaceholder"
        @blur="save({ sessionDir })"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeShellPath }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeShellPathHint }}</NText>
      </div>
      <NInput
        v-model:value="shellPath"
        size="small"
        class="setting-input"
        :placeholder="t.runtimeShellPathPlaceholder"
        @blur="save({ shellPath })"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeShellPrefix }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeShellPrefixHint }}</NText>
      </div>
      <NInput
        v-model:value="shellCommandPrefix"
        size="small"
        class="setting-input"
        :placeholder="t.runtimeShellPrefixPlaceholder"
        @blur="save({ shellCommandPrefix })"
      />
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.runtimeAdvancedSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimeAdvancedSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeAnthropicExtraUsage }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeAnthropicExtraUsageHint }}</NText>
      </div>
      <NRadioGroup v-model:value="anthropicExtraUsage" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeWsTimeout }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeWsTimeoutHint }}</NText>
      </div>
      <NSelect
        :value="wsTimeoutValue"
        :options="wsTimeoutOptions"
        size="small"
        class="setting-select"
        @update:value="onWsTimeout"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeSkillCommands }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeSkillCommandsHint }}</NText>
      </div>
      <NRadioGroup v-model:value="skillCommands" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.runtimePrivacySection }}</NText>
      <NText depth="3" class="section-hint">{{ t.runtimePrivacySectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeAnalytics }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeAnalyticsHint }}</NText>
      </div>
      <NRadioGroup v-model:value="analytics" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.runtimeInstallTelemetry }}</NText>
        <NText depth="3" class="row-hint">{{ t.runtimeInstallTelemetryHint }}</NText>
      </div>
      <NRadioGroup v-model:value="installTelemetry" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>
  </div>
</template>

<style scoped>
.runtime-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 20px;
}

.section-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-hint,
.row-hint {
  font-size: 12px;
  line-height: 16px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.switch-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.setting-select {
  flex-shrink: 0;
  width: 128px;
}

.setting-input {
  flex-shrink: 0;
  width: 260px;
}

.setting-radio-group {
  flex-shrink: 0;
  width: 120px;
  display: inline-flex;
}

.setting-radio-group :deep(.n-radio-button) {
  flex: 1;
  padding: 0;
  text-align: center;
}

.override-head {
  margin-top: 4px;
}

.override-add {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.override-model-select {
  width: 320px;
}

.override-empty {
  display: flex;
  justify-content: flex-end;
}

.override-label,
.override-key {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.override-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.override-field-label {
  font-size: 12px;
  white-space: nowrap;
}
</style>
