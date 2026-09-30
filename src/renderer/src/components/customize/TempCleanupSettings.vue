<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { NButton, NSelect, NSwitch, useMessage } from "naive-ui";
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

const intervalOptions = computed(() =>
	TEMP_CLEANUP_INTERVALS.map((hours) => ({
		label: t.tempCleanupIntervalLabel(hours),
		value: hours,
	})),
);

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

function onToggle(value: boolean): void {
	void save({ ...settings.value, enabled: value });
}

function onInterval(value: number): void {
	void save({ ...settings.value, intervalHours: value });
}

function onMaxAge(value: number): void {
	void save({ ...settings.value, maxAgeHours: value });
}

const ageOptions = computed(() => [1, 6, 12, 24, 72, 168].map((hours) => ({
	label: t.tempCleanupIntervalLabel(hours),
	value: hours,
})));

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
	} catch (err) {
		message.error(err instanceof Error ? err.message : String(err));
	} finally {
		sweeping.value = false;
	}
}
</script>

<template>
  <div v-if="loaded" class="temp-cleanup">
    <div class="temp-cleanup-row">
      <div class="temp-cleanup-text">
        <span class="temp-cleanup-name">{{ t.tempCleanupEnabled }}</span>
        <span class="temp-cleanup-hint">{{ t.tempCleanupEnabledHint }}</span>
      </div>
      <NSwitch :value="settings.enabled" @update:value="onToggle" />
    </div>

    <div class="temp-cleanup-row">
      <div class="temp-cleanup-text">
        <span class="temp-cleanup-name">{{ t.tempCleanupInterval }}</span>
        <span class="temp-cleanup-hint">{{ t.tempCleanupIntervalHint }}</span>
      </div>
      <NSelect
        class="temp-cleanup-select"
        size="small"
        :value="settings.intervalHours"
        :options="intervalOptions"
        :disabled="!settings.enabled"
        @update:value="onInterval"
      />
    </div>

    <div class="temp-cleanup-row">
      <div class="temp-cleanup-text">
        <span class="temp-cleanup-name">{{ t.tempCleanupMaxAge }}</span>
        <span class="temp-cleanup-hint">{{ t.tempCleanupMaxAgeHint }}</span>
      </div>
      <NSelect
        class="temp-cleanup-select"
        size="small"
        :value="settings.maxAgeHours"
        :options="ageOptions"
        :disabled="!settings.enabled"
        @update:value="onMaxAge"
      />
    </div>

    <div class="temp-cleanup-row">
      <div class="temp-cleanup-text" />
      <NButton size="small" :loading="sweeping" @click="sweepNow">
        {{ t.tempCleanupSweepNow }}
      </NButton>
    </div>
  </div>
</template>

<style scoped>
.temp-cleanup {
  display: flex;
  flex-direction: column;
}

.temp-cleanup-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 16px;
  border-top: 1px solid var(--border);
}

.temp-cleanup-row:first-child {
  border-top: none;
}

.temp-cleanup-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.temp-cleanup-name {
  font-size: 13px;
  line-height: 18px;
  color: var(--fg);
}

.temp-cleanup-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--fg-muted);
}

.temp-cleanup-select {
  width: 168px;
  flex-shrink: 0;
}
</style>
