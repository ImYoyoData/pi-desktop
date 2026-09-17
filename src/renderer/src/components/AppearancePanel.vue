<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NDivider,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from "naive-ui";
import {
  TRUNCATE_TOOL_OUTPUT_CHOICES,
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import {
  normalizeThinkingLanguage,
  type ThinkingLanguage,
} from "../../../shared/thinking-language";
import { MESSAGE_WIDTH_CHOICES } from "../../../shared/appearance";
import AppearanceWallpaperCard from "@renderer/components/customize/AppearanceWallpaperCard.vue";
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

const thinkingLanguage = ref<ThinkingLanguage>("en");
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

const showPanelDividers = computed({
  get: () => appearance.showPanelDividers,
  set: (value: boolean) => appearance.setShowPanelDividers(value),
});

const showSessionDetails = computed({
  get: () => appearance.showSessionDetails,
  set: (value: boolean) => appearance.setShowSessionDetails(value),
});

const showSessionTitle = computed({
  get: () => appearance.showSessionTitle,
  set: (value: boolean) => appearance.setShowSessionTitle(value),
});

const showSessionHoverActions = computed({
  get: () => appearance.showSessionHoverActions,
  set: (value: boolean) => appearance.setSessionHoverActions(value),
});

const showMessagePreview = computed({
  get: () => appearance.showMessagePreview,
  set: (value: boolean) => appearance.setShowMessagePreview(value),
});

const showMessagePreviewImage = computed({
  get: () => appearance.showMessagePreviewImage,
  set: (value: boolean) => appearance.setShowMessagePreviewImage(value),
});

const truncateOptions = computed(() =>
  TRUNCATE_TOOL_OUTPUT_CHOICES.map((lines) => ({
    label: lines === 0 ? t.truncateToolOutputOff : t.truncateToolOutputLines(lines),
    value: lines,
  })),
);

const messageWidthOptions = computed(() =>
  MESSAGE_WIDTH_CHOICES.map((value) => ({
    label: t.appearanceMessageWidthValue(Math.round(value * 100)),
    value,
  })),
);

function onTruncateChange(value: string | number | null): void {
  if (typeof value === "number") appearance.setTruncateToolOutputLines(value);
}

function onMessageWidthChange(value: string | number | null): void {
  if (typeof value === "number") appearance.setMessageWidth(value);
}
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
      <AppearanceWallpaperCard />

      <div class="theme-locale-grid">
        <NText strong>{{ t.theme }}</NText>
        <NRadioGroup v-model:value="themeValue" size="small" class="theme-locale-radio">
          <NRadioButton value="system">{{ t.themeSystem }}</NRadioButton>
          <NRadioButton value="light">{{ t.themeLight }}</NRadioButton>
          <NRadioButton value="dark">{{ t.themeDark }}</NRadioButton>
        </NRadioGroup>

        <NDivider style="margin: 0" class="theme-locale-divider" />

        <NText strong>{{ t.language }}</NText>
        <NRadioGroup
          :value="appearance.localePreference"
          size="small"
          class="theme-locale-radio"
          @update:value="onLocaleUpdate"
        >
          <NRadioButton value="system">{{ t.themeSystem }}</NRadioButton>
          <NRadioButton value="zh-CN">中文</NRadioButton>
          <NRadioButton value="en">English</NRadioButton>
        </NRadioGroup>
      </div>
    </template>

    <template v-else>
      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.thinkingLanguage }}</NText>
        </div>
        <NRadioGroup
          :value="thinkingLanguage"
          size="small"
          :disabled="thinkingLanguageSaving"
          class="setting-radio-group"
          @update:value="saveThinkingLanguage"
        >
          <NRadioButton value="zh">{{ t.thinkingLanguageZh }}</NRadioButton>
          <NRadioButton value="en">{{ t.thinkingLanguageEn }}</NRadioButton>
        </NRadioGroup>
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.showPanelDividers }}</NText>
        </div>
        <NRadioGroup
          v-model:value="showPanelDividers"
          size="small"
          class="setting-radio-group"
        >
          <NRadioButton :value="true">{{ t.showCompactButtonOn }}</NRadioButton>
          <NRadioButton :value="false">{{ t.showCompactButtonOff }}</NRadioButton>
        </NRadioGroup>
      </div>

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.showSessionTitle }}</NText>
        </div>
        <NRadioGroup
          v-model:value="showSessionTitle"
          size="small"
          class="setting-radio-group"
        >
          <NRadioButton :value="true">{{ t.showCompactButtonOn }}</NRadioButton>
          <NRadioButton :value="false">{{ t.showCompactButtonOff }}</NRadioButton>
        </NRadioGroup>
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.showCompactButton }}</NText>
        </div>
        <NRadioGroup
          v-model:value="showCompactButton"
          size="small"
          class="setting-radio-group"
        >
          <NRadioButton :value="true">{{ t.showCompactButtonOn }}</NRadioButton>
          <NRadioButton :value="false">{{ t.showCompactButtonOff }}</NRadioButton>
        </NRadioGroup>
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.truncateToolOutput }}</NText>
        </div>
        <NSelect
          :value="appearance.truncateToolOutputLines"
          :options="truncateOptions"
          size="small"
          class="setting-select"
          @update:value="onTruncateChange"
        />
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.appearanceMessageWidth }}</NText>
        </div>
        <NSelect
          :value="appearance.messageWidth"
          :options="messageWidthOptions"
          size="small"
          class="setting-select"
          @update:value="onMessageWidthChange"
        />
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.showSessionDetails }}</NText>
        </div>
        <NRadioGroup
          v-model:value="showSessionDetails"
          size="small"
          class="setting-radio-group"
        >
          <NRadioButton :value="true">{{ t.showCompactButtonOn }}</NRadioButton>
          <NRadioButton :value="false">{{ t.showCompactButtonOff }}</NRadioButton>
        </NRadioGroup>
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.messagePreview }}</NText>
        </div>
        <NRadioGroup
          v-model:value="showMessagePreview"
          size="small"
          class="setting-radio-group"
        >
          <NRadioButton :value="true">{{ t.showCompactButtonOn }}</NRadioButton>
          <NRadioButton :value="false">{{ t.showCompactButtonOff }}</NRadioButton>
        </NRadioGroup>
      </div>

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.messagePreviewImage }}</NText>
        </div>
        <NRadioGroup
          v-model:value="showMessagePreviewImage"
          size="small"
          class="setting-radio-group"
          :disabled="!appearance.showMessagePreview"
        >
          <NRadioButton :value="true">{{ t.showCompactButtonOn }}</NRadioButton>
          <NRadioButton :value="false">{{ t.showCompactButtonOff }}</NRadioButton>
        </NRadioGroup>
      </div>

      <NDivider style="margin: 0" />

      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.sessionHoverActions }}</NText>
        </div>
        <NRadioGroup
          v-model:value="showSessionHoverActions"
          size="small"
          class="setting-radio-group"
        >
          <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
          <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
        </NRadioGroup>
      </div>
    </template>
  </div>
</template>

<style scoped>
.appearance-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  container-type: inline-size;
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
  width: 120px;
}

.setting-radio-group {
  flex-shrink: 0;
  width: 120px;
  display: inline-flex;
}

.theme-locale-grid {
  display: grid;
  grid-template-columns: 1fr max-content;
  align-items: center;
  gap: 16px 12px;
}

.theme-locale-divider {
  grid-column: 1 / -1;
}

.theme-locale-radio {
  display: flex;
}

.theme-locale-radio :deep(.n-radio-button) {
  flex: 1;
  text-align: center;
}

.setting-radio-group :deep(.n-radio-button) {
  flex: 1;
  padding: 0;
  text-align: center;
}
</style>
