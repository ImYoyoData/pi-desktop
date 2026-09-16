<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NDivider,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NSwitch,
  NText,
  useMessage,
} from "naive-ui";
import {
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import {
  normalizeThinkingLanguage,
  type ThinkingLanguage,
} from "../../../shared/thinking-language";
import { t } from "@renderer/i18n";

/** 外观设置：主题与界面两个子页；设置模态与智能体设置页共用。 */
const appearance = useAppearanceStore();
const message = useMessage();

type AppearanceTab = "theme" | "ui";
const TAB_KEY = "pi-desktop:appearance-tab:v1";

const tab = ref<AppearanceTab>(localStorage.getItem(TAB_KEY) === "ui" ? "ui" : "theme");

function onTabUpdate(value: string | number | null): void {
  if (value !== "theme" && value !== "ui") return;
  tab.value = value;
  localStorage.setItem(TAB_KEY, value);
}

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

const thinkingLanguage = ref<ThinkingLanguage>("auto");
const thinkingLanguageSaving = ref(false);

onMounted(() => {
  void loadThinkingLanguage();
});

async function loadThinkingLanguage(): Promise<void> {
  try {
    const settings = await window.api.thinkingLanguage.get();
    thinkingLanguage.value = settings.language;
  } catch {
    // 读取失败时保留当前值
  }
}

async function saveThinkingLanguage(value: string | number): Promise<void> {
  const language = normalizeThinkingLanguage(value);
  thinkingLanguage.value = language;
  thinkingLanguageSaving.value = true;
  try {
    const settings = await window.api.thinkingLanguage.set({ language });
    thinkingLanguage.value = settings.language;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    thinkingLanguageSaving.value = false;
  }
}

const showCompactButton = computed({
  get: () => appearance.showCompactButton,
  set: (value: boolean) => appearance.setShowCompactButton(value),
});

const truncateToolOutput = computed({
  get: () => appearance.truncateToolOutput,
  set: (value: boolean) => appearance.setTruncateToolOutput(value),
});
</script>

<template>
  <div class="appearance-panel">
    <NRadioGroup :value="tab" size="small" @update:value="onTabUpdate">
      <NSpace>
        <NRadioButton value="theme">{{ t.theme }}</NRadioButton>
        <NRadioButton value="ui">{{ t.appearanceInterface }}</NRadioButton>
      </NSpace>
    </NRadioGroup>

    <template v-if="tab === 'theme'">
      <div class="section">
        <NText strong>{{ t.theme }}</NText>
        <NRadioGroup v-model:value="themeValue" size="small">
          <NSpace>
            <NRadioButton value="system">{{ t.themeSystem }}</NRadioButton>
            <NRadioButton value="light">{{ t.themeLight }}</NRadioButton>
            <NRadioButton value="dark">{{ t.themeDark }}</NRadioButton>
          </NSpace>
        </NRadioGroup>
      </div>

      <NDivider style="margin: 0" />

      <div class="section">
        <NText strong>{{ t.language }}</NText>
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
    </template>

    <template v-else>
      <div class="section">
        <NText strong>{{ t.thinkingLanguage }}</NText>
        <NText depth="3" class="hint">{{ t.thinkingLanguageHint }}</NText>
        <NRadioGroup
          :value="thinkingLanguage"
          size="small"
          :disabled="thinkingLanguageSaving"
          @update:value="saveThinkingLanguage"
        >
          <NSpace>
            <NRadioButton value="auto">{{ t.thinkingLanguageAuto }}</NRadioButton>
            <NRadioButton value="zh">{{ t.thinkingLanguageZh }}</NRadioButton>
            <NRadioButton value="en">English</NRadioButton>
          </NSpace>
        </NRadioGroup>
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.showCompactButton }}</NText>
          <NText depth="3" class="hint">{{ t.showCompactButtonHint }}</NText>
        </div>
        <NSwitch v-model:value="showCompactButton" />
      </div>

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.truncateToolOutput }}</NText>
          <NText depth="3" class="hint">{{ t.truncateToolOutputHint }}</NText>
        </div>
        <NSwitch v-model:value="truncateToolOutput" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.appearance-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.hint {
  font-size: 12px;
}
</style>
