<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NRadioButton, NRadioGroup, NText, useMessage } from "naive-ui";
import {
  normalizeThinkingLanguage,
  type ThinkingLanguage,
} from "../../../../shared/thinking-language";
import { t } from "@renderer/i18n";

const message = useMessage();

const language = ref<ThinkingLanguage>("en");
const saving = ref(false);

onMounted(() => void load());

async function load(): Promise<void> {
  try {
    language.value = (await window.api.thinkingLanguage.get()).language;
  } catch {
    // 读取失败时保留默认值
  }
}

async function save(value: string | number): Promise<void> {
  const next = normalizeThinkingLanguage(value);
  language.value = next;
  saving.value = true;
  try {
    language.value = (await window.api.thinkingLanguage.set({ language: next })).language;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="thinking-language-row">
    <div class="row-labels">
      <NText strong>{{ t.thinkingLanguage }}</NText>
      <NText depth="3" class="row-hint">{{ t.thinkingLanguageHint }}</NText>
    </div>
    <NRadioGroup
      :value="language"
      size="small"
      :disabled="saving"
      class="row-radio"
      @update:value="save"
    >
      <NRadioButton value="zh">{{ t.thinkingLanguageZh }}</NRadioButton>
      <NRadioButton value="en">{{ t.thinkingLanguageEn }}</NRadioButton>
    </NRadioGroup>
  </div>
</template>

<style scoped>
.thinking-language-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px 6px 16px;
}

.row-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row-hint {
  font-size: 12px;
  line-height: 1.45;
}

.row-radio {
  display: flex;
  flex-shrink: 0;
  width: 120px;
}

.row-radio :deep(.n-radio-button) {
  flex: 1;
  padding: 0;
  text-align: center;
}
</style>