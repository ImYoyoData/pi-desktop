<script setup lang="ts">
import { computed } from "vue";
import { NModal, NRadioGroup, NRadioButton, NSpace, NText, NButton, NDivider } from "naive-ui";
import {
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const appearance = useAppearanceStore();

const themeValue = computed({
  get: () => appearance.themePreference,
  set: (v: ThemePreference) => appearance.setThemePreference(v),
});

function onLocaleUpdate(v: string | number | null): void {
  if (v !== "system" && v !== "zh-CN" && v !== "en") return;
  appearance.setLocalePreference(v as LocalePreference);
  window.location.reload();
}
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(440px, 92vw)"
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
.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
