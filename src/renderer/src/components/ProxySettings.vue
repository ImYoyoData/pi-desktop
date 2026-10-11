<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NInput,
  NRadioButton,
  NRadioGroup,
  NText,
  useMessage,
} from "naive-ui";
import {
  normalizeProxyUrl,
  type ProxyMode,
} from "../../../shared/proxy";
import { t } from "@renderer/i18n";

const message = useMessage();

const mode = ref<ProxyMode>("off");
const url = ref("");
const loaded = ref(false);

onMounted(async () => {
  try {
    const current = await window.api.proxy.get();
    mode.value = current.mode;
    url.value = current.url;
  } catch {
  } finally {
    loaded.value = true;
  }
});

let applyChain: Promise<void> = Promise.resolve();

function apply(showSuccess = false): void {
  applyChain = applyChain.then(async () => {
    try {
      const applied = await window.api.proxy.set({
        mode: mode.value,
        url: url.value.trim(),
      });
      mode.value = applied.mode;
      url.value = applied.url;
      if (showSuccess) message.success(t.proxyApplied);
    } catch {
      message.error(t.proxyInvalidUrl);
    }
  });
}

function onMode(next: ProxyMode): void {
  if (!loaded.value || next === mode.value) return;
  mode.value = next;
  if (next === "custom" && !normalizeProxyUrl(url.value)) return;
  apply(true);
}

let urlTimer: ReturnType<typeof setTimeout> | undefined;

function onUrl(next: string): void {
  url.value = next;
  if (!loaded.value || mode.value !== "custom") return;
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    if (normalizeProxyUrl(url.value)) apply();
  }, 600);
}

const urlInvalid = computed(
  () =>
    mode.value === "custom" &&
    url.value.trim().length > 0 &&
    normalizeProxyUrl(url.value) === null,
);
</script>

<template>
  <section class="settings-group">
    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.proxyTitle }}</NText>
      </div>
      <NRadioGroup :value="mode" size="small" class="setting-radio-group" @update:value="onMode">
        <NRadioButton value="off">{{ t.proxyModeOff }}</NRadioButton>
        <NRadioButton value="system">{{ t.proxyModeSystem }}</NRadioButton>
        <NRadioButton value="custom">{{ t.proxyModeCustom }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div v-if="mode === 'custom'" class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.proxyUrlLabel }}</NText>
      </div>
      <NInput
        class="url-input"
        :value="url"
        size="small"
        :status="urlInvalid ? 'error' : undefined"
        :placeholder="t.proxyUrlPlaceholder"
        @update:value="onUrl"
      />
    </div>
  </section>
</template>

<style scoped>
.settings-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.setting-radio-group {
  flex-shrink: 0;
  width: 168px;
  display: inline-flex;
}

.setting-radio-group :deep(.n-radio-button) {
  flex: 1;
  padding: 0;
  text-align: center;
}

.url-input {
  width: 320px;
  flex-shrink: 0;
}
</style>
