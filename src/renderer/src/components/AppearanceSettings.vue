<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import {
  NModal,
  NRadioGroup,
  NRadioButton,
  NSpace,
  NText,
  NButton,
  NDivider,
  NSwitch,
  useMessage,
} from "naive-ui";
import {
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import { useAsrStore } from "@renderer/stores/asr";
import AsrInstallProgress from "@renderer/components/AsrInstallProgress.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const appearance = useAppearanceStore();
const asr = useAsrStore();
const message = useMessage();
let offProgress: (() => void) | undefined;

const themeValue = computed({
  get: () => appearance.themePreference,
  set: (v: ThemePreference) => appearance.setThemePreference(v),
});

const asrEnabled = computed({
  get: () => asr.status.enabled,
  set: (v: boolean) => {
    void asr.setEnabled(v);
  },
});

function onLocaleUpdate(v: string | number | null): void {
  if (v !== "system" && v !== "zh-CN" && v !== "en") return;
  appearance.setLocalePreference(v as LocalePreference);
  window.location.reload();
}

async function onInstall(): Promise<void> {
  const ok = window.confirm(t.asrInstallConfirm(asr.status.diskMb, asr.status.ramMb));
  if (!ok) return;
  try {
    await asr.install();
    message.success(t.asrInstallOk);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

async function onUninstall(): Promise<void> {
  await asr.uninstall();
}

watch(
  () => props.open,
  (open) => {
    if (open) void asr.refresh();
  },
);

onMounted(() => {
  offProgress = asr.bindProgress();
  void asr.refresh();
});

onUnmounted(() => {
  offProgress?.();
});
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(480px, 92vw)"
    :title="t.appearance"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <div class="section">
      <NText strong>{{ t.theme }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.themeHint }}
      </NText>
      <NRadioGroup v-model:value="themeValue" size="small">
        <NSpace>
          <NRadioButton value="system">{{ t.themeSystem }}</NRadioButton>
          <NRadioButton value="light">{{ t.themeLight }}</NRadioButton>
          <NRadioButton value="dark">{{ t.themeDark }}</NRadioButton>
        </NSpace>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <NText strong>{{ t.language }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.languageHint }}
      </NText>
      <NRadioGroup
        :value="appearance.localePreference"
        size="small"
        @update:value="onLocaleUpdate"
      >
        <NSpace>
          <NRadioButton value="system">{{ t.themeSystem }}</NRadioButton>
          <NRadioButton value="zh-CN">中文</NRadioButton>
          <NRadioButton value="en">English</NRadioButton>
        </NSpace>
      </NRadioGroup>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <NText strong>{{ t.asrTitle }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.asrHint }}
      </NText>
      <div class="asr-row">
        <span>{{ t.asrEnable }}</span>
        <NSwitch v-model:value="asrEnabled" size="small" :disabled="!asr.status.supported" />
      </div>
      <NText depth="3" style="font-size: 12px; margin-top: 8px">
        {{ asr.status.modelLabel }} ·
        {{ asr.status.installed ? t.asrInstalled : t.asrNotInstalled }} · ≈{{ asr.status.diskMb }}MB
        disk / ≈{{ asr.status.ramMb }}MB RAM
      </NText>
      <NSpace style="margin-top: 10px" :size="8">
        <NButton
          size="small"
          type="primary"
          :disabled="!asr.status.supported || asr.installing || asr.status.installed"
          :loading="asr.installing"
          @click="onInstall"
        >
          {{ t.asrInstall }}
        </NButton>
        <NButton
          size="small"
          :disabled="!asr.status.installed || asr.installing"
          @click="onUninstall"
        >
          {{ t.asrUninstall }}
        </NButton>
      </NSpace>
      <AsrInstallProgress v-if="asr.installing || asr.progress?.phase === 'error'" style="margin-top: 12px" />
    </div>

    <template #footer>
      <div class="footer">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
}
.asr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
