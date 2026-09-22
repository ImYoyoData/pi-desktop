<script setup lang="ts">
import { computed } from "vue";
import { NDivider, NRadioButton, NRadioGroup, NSelect, NText } from "naive-ui";
import {
  RETRY_BASE_DELAY_CHOICES,
  RETRY_COUNT_CHOICES,
  RETRY_DESKTOP_COUNT_CHOICES,
  RETRY_MAX_DELAY_CHOICES,
  RETRY_SOFT_HANG_SILENCE_CHOICES,
  RETRY_STALL_SILENCE_CHOICES,
  RETRY_TIMEOUT_CHOICES,
  type RetrySettings,
} from "../../../../shared/retry-settings";
import { useRetryStore } from "@renderer/stores/retry";
import { t } from "@renderer/i18n";

const retry = useRetryStore();
void retry.load();

/** 请求超时下拉的「默认」档位（跟跟随 httpIdleTimeoutMs）。 */
const TIMEOUT_DEFAULT = -1;

type Option = { label: string; value: number };

function countOptions(values: readonly number[]): Option[] {
  return values.map((value) => ({ label: String(value), value }));
}

function durationOptions(
  values: readonly number[],
  label: (ms: number) => string,
): Option[] {
  return values.map((value) => ({ label: label(value), value }));
}

const maxRetryOptions = countOptions(RETRY_COUNT_CHOICES);
const baseDelayOptions = durationOptions(RETRY_BASE_DELAY_CHOICES, t.retryDuration);
const maxDelayOptions = durationOptions(RETRY_MAX_DELAY_CHOICES, (ms) =>
  ms === 0 ? t.retryValueUnlimited : t.retryDuration(ms),
);
const timeoutOptions: Option[] = RETRY_TIMEOUT_CHOICES.map((ms) => ({
  label: ms === null ? t.retryValueDefault : t.retryDuration(ms),
  value: ms === null ? TIMEOUT_DEFAULT : ms,
}));
const timeoutValue = computed(
  () => retry.settings.provider.timeoutMs ?? TIMEOUT_DEFAULT,
);
const desktopCountOptions = countOptions(RETRY_DESKTOP_COUNT_CHOICES);
const softHangSilenceOptions = durationOptions(RETRY_SOFT_HANG_SILENCE_CHOICES, t.retryDuration);
const stallSilenceOptions = durationOptions(RETRY_STALL_SILENCE_CHOICES, t.retryDuration);

const enabled = computed({
  get: () => retry.settings.enabled,
  set: (value: boolean) => save({ enabled: value }),
});

function save(patch: Partial<RetrySettings>): void {
  void retry.save({ ...retry.settings, ...patch });
}

function saveProvider(patch: Partial<RetrySettings["provider"]>): void {
  save({ provider: { ...retry.settings.provider, ...patch } });
}

function saveDesktop(patch: Partial<RetrySettings["desktop"]>): void {
  save({ desktop: { ...retry.settings.desktop, ...patch } });
}

function onNumber(apply: (value: number) => void) {
  return (value: string | number | null): void => {
    if (typeof value === "number") apply(value);
  };
}

function onTimeout(value: string | number | null): void {
  if (value === TIMEOUT_DEFAULT) return saveProvider({ timeoutMs: null });
  if (typeof value === "number") saveProvider({ timeoutMs: value });
}

const onMaxRetries = onNumber((value) => save({ maxRetries: value }));
const onBaseDelay = onNumber((value) => save({ baseDelayMs: value }));
const onProviderMaxRetries = onNumber((value) => saveProvider({ maxRetries: value }));
const onProviderMaxDelay = onNumber((value) => saveProvider({ maxRetryDelayMs: value }));
const onRecoverMax = onNumber((value) => saveDesktop({ recoverMax: value }));
const onSoftHangMax = onNumber((value) => saveDesktop({ softHangMax: value }));
const onSoftHangSilence = onNumber((value) => saveDesktop({ softHangSilenceMs: value }));
const onStallSilence = onNumber((value) => saveDesktop({ stallSilenceMs: value }));
</script>

<template>
  <div class="retry-settings">
    <div class="section-head">
      <NText strong>{{ t.retryAutoSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.retryAutoSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryEnabled }}</NText>
      </div>
      <NRadioGroup v-model:value="enabled" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryMaxRetries }}</NText>
      </div>
      <NSelect
        :value="retry.settings.maxRetries"
        :options="maxRetryOptions"
        :disabled="!retry.settings.enabled"
        size="small"
        class="setting-select"
        @update:value="onMaxRetries"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryBaseDelay }}</NText>
        <NText depth="3" class="row-hint">{{ t.retryBaseDelayHint }}</NText>
      </div>
      <NSelect
        :value="retry.settings.baseDelayMs"
        :options="baseDelayOptions"
        :disabled="!retry.settings.enabled"
        size="small"
        class="setting-select"
        @update:value="onBaseDelay"
      />
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.retryProviderSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.retryProviderSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryProviderMaxRetries }}</NText>
      </div>
      <NSelect
        :value="retry.settings.provider.maxRetries"
        :options="maxRetryOptions"
        size="small"
        class="setting-select"
        @update:value="onProviderMaxRetries"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryProviderMaxDelay }}</NText>
        <NText depth="3" class="row-hint">{{ t.retryProviderMaxDelayHint }}</NText>
      </div>
      <NSelect
        :value="retry.settings.provider.maxRetryDelayMs"
        :options="maxDelayOptions"
        size="small"
        class="setting-select"
        @update:value="onProviderMaxDelay"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryProviderTimeout }}</NText>
        <NText depth="3" class="row-hint">{{ t.retryProviderTimeoutHint }}</NText>
      </div>
      <NSelect
        :value="timeoutValue"
        :options="timeoutOptions"
        size="small"
        class="setting-select"
        @update:value="onTimeout"
      />
    </div>

    <NDivider style="margin: 0" />

    <div class="section-head">
      <NText strong>{{ t.retryDesktopSection }}</NText>
      <NText depth="3" class="section-hint">{{ t.retryDesktopSectionHint }}</NText>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryDesktopRecoverMax }}</NText>
      </div>
      <NSelect
        :value="retry.settings.desktop.recoverMax"
        :options="desktopCountOptions"
        size="small"
        class="setting-select"
        @update:value="onRecoverMax"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryDesktopSoftHangMax }}</NText>
      </div>
      <NSelect
        :value="retry.settings.desktop.softHangMax"
        :options="desktopCountOptions"
        size="small"
        class="setting-select"
        @update:value="onSoftHangMax"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryDesktopSoftHangSilence }}</NText>
        <NText depth="3" class="row-hint">{{ t.retryDesktopSoftHangSilenceHint }}</NText>
      </div>
      <NSelect
        :value="retry.settings.desktop.softHangSilenceMs"
        :options="softHangSilenceOptions"
        size="small"
        class="setting-select"
        @update:value="onSoftHangSilence"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.retryDesktopStallSilence }}</NText>
        <NText depth="3" class="row-hint">{{ t.retryDesktopStallSilenceHint }}</NText>
      </div>
      <NSelect
        :value="retry.settings.desktop.stallSilenceMs"
        :options="stallSilenceOptions"
        size="small"
        class="setting-select"
        @update:value="onStallSilence"
      />
    </div>
  </div>
</template>

<style scoped>
.retry-settings {
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
</style>
