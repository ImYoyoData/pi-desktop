<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NRadioGroup,
  NRadioButton,
  NSpace,
  NText,
  NDivider,
  NSwitch,
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
import {
  markLocaleReloading,
  showLocaleReloadSplash,
} from "@renderer/utils/locale-reload-splash";

/** 外观设置表单；设置模态与智能体设置页共用。 */
const appearance = useAppearanceStore();
const message = useMessage();

/** 思考语言：只影响可见思考文本。 */
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
  set: (v: boolean) => appearance.setShowCompactButton(v),
});

const truncateToolOutput = computed({
  get: () => appearance.truncateToolOutput,
  set: (v: boolean) => appearance.setTruncateToolOutput(v),
});

const themeValue = computed({
  get: () => appearance.themePreference,
  set: (v: ThemePreference) => appearance.setThemePreference(v),
});

function onLocaleUpdate(v: string | number | null): void {
  if (v !== "system" && v !== "zh-CN" && v !== "en") return;
  if (v === appearance.localePreference) return;
  appearance.setLocalePreference(v as LocalePreference);
  markLocaleReloading(v);
  // Paint overlay in the outgoing page so reload never shows a blank window.
  showLocaleReloadSplash(v);
  window.setTimeout(() => {
    window.location.reload();
  }, 40);
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

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <NText strong>{{ t.thinkingLanguage }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.thinkingLanguageHint }}
      </NText>
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

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <div class="row">
        <div class="labels">
          <NText strong>{{ t.showCompactButton }}</NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ t.showCompactButtonHint }}
          </NText>
        </div>
        <NSwitch v-model:value="showCompactButton" />
      </div>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <div class="row">
        <div class="labels">
          <NText strong>{{ t.truncateToolOutput }}</NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ t.truncateToolOutputHint }}
          </NText>
        </div>
        <NSwitch v-model:value="truncateToolOutput" />
      </div>
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
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.labels {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
