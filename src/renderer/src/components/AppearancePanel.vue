<script setup lang="ts">
import { computed } from "vue";
import {
  NRadioGroup,
  NRadioButton,
  NSpace,
  NText,
  NDivider,
} from "naive-ui";
import {
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import { t } from "@renderer/i18n";

/** 外观设置表单；设置模态与智能体设置页共用。 */
const appearance = useAppearanceStore();

const themeValue = computed({
  get: () => appearance.themePreference,
  set: (v: ThemePreference) => appearance.setThemePreference(v),
});

/** 切换语言：原地替换界面文案，不刷页、不显示加载页。 */
function onLocaleUpdate(v: string | number | null): void {
  if (v !== "system" && v !== "zh-CN" && v !== "en") return;
  if (v === appearance.localePreference) return;
  appearance.setLocalePreference(v as LocalePreference);
}
</script>

<template>
  <div class="appearance-panel">
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
  </div>
</template>

<style scoped>
.appearance-panel {
  display: flex;
  flex-direction: column;
}
.section {
  display: flex;
  flex-direction: column;
}
</style>
