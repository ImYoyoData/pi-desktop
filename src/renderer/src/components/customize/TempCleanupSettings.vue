<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton, NRadioButton, NRadioGroup, NSelect, NText, useMessage } from "naive-ui";
import type { TempCleanupSettings } from "../../../../shared/temp-cleanup";
import {
	DEFAULT_TEMP_CLEANUP_SETTINGS,
	TEMP_CLEANUP_INTERVALS,
} from "../../../../shared/temp-cleanup";
import { t } from "@renderer/i18n";

const message = useMessage();
const settings = ref<TempCleanupSettings>({ ...DEFAULT_TEMP_CLEANUP_SETTINGS });
const sweeping = ref(false);
const loaded = ref(false);
const statsText = ref("");
const statsLoading = ref(false);

const intervalOptions = computed(() =>
	TEMP_CLEANUP_INTERVALS.map((hours) => ({
		label: t.tempCleanupIntervalLabel(hours),
		value: hours,
	})),
);

const ageOptions = computed(() => [1, 6, 12, 24, 72, 168].map((hours) => ({
	label: t.tempCleanupIntervalLabel(hours),
	value: hours,
})));

onMounted(async () => {
	try {
		settings.value = await window.api.tempCleanup.get();
	} catch {
		// 读不到就用默认值，不阻塞页面
	}
	loaded.value = true;
});

async function save(next: TempCleanupSettings): Promise<void> {
	settings.value = next;
	try {
		settings.value = await window.api.tempCleanup.set(next);
	} catch (err) {
		message.error(err instanceof Error ? err.message : String(err));
	}
}

const enabledControl = computed({
	get: () => settings.value.enabled,
	set: (value: boolean) => onToggle(value),
});

function onToggle(value: boolean): void {
	void save({ ...settings.value, enabled: value });
}

function onInterval(value: number): void {
	void save({ ...settings.value, intervalHours: value });
}

function onMaxAge(value: number): void {
	void save({ ...settings.value, maxAgeHours: value });
}

async function showStats(): Promise<void> {
	if (statsLoading.value) return;
	statsLoading.value = true;
	try {
		const result = await window.api.tempCleanup.stats();
		statsText.value = t.tempCleanupStatsResult(
			result.count,
			result.bytes / 1024 / 1024,
		);
	} catch (err) {
		message.error(err instanceof Error ? err.message : String(err));
	} finally {
		statsLoading.value = false;
	}
}

async function sweepNow(): Promise<void> {
	if (sweeping.value) return;
	sweeping.value = true;
	try {
		const result = await window.api.tempCleanup.sweep();
		if (result.removed > 0) {
			message.success(
				t.tempCleanupSweepDone(result.removed, result.bytes / 1024 / 1024),
			);
		} else {
			message.info(t.tempCleanupSweepEmpty);
		}
		if (statsText.value) await showStats();
	} catch (err) {
		message.error(err instanceof Error ? err.message : String(err));
	} finally {
		sweeping.value = false;
	}
}
</script>

<template>
  <div v-if="loaded" class="temp-cleanup">
    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.tempCleanupEnabled }}</NText>
      </div>
      <NRadioGroup v-model:value="enabledControl" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.tempCleanupInterval }}</NText>
      </div>
      <NSelect
        class="setting-select"
        size="small"
        :value="settings.intervalHours"
        :options="intervalOptions"
        :disabled="!settings.enabled"
        @update:value="onInterval"
      />
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.tempCleanupMaxAge }}</NText>
      </div>
      <NSelect
        class="setting-select"
        size="small"
        :value="settings.maxAgeHours"
        :options="ageOptions"
        :disabled="!settings.enabled"
        @update:value="onMaxAge"
      />
    </div>

    <div class="switch-row">
      <NText depth="3" class="row-hint stats-text">{{ statsText }}</NText>
      <NButton size="small" secondary :loading="statsLoading" @click="showStats">
        {{ t.tempCleanupStats }}
      </NButton>
      <NButton size="small" secondary :loading="sweeping" @click="sweepNow">
        {{ t.tempCleanupSweepNow }}
      </NButton>
    </div>
  </div>
</template>

<style scoped>
.temp-cleanup {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

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

.stats-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
