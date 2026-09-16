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
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import { useAppearanceStore } from "@renderer/stores/appearance";
import {
  normalizeThinkingLanguage,
  type ThinkingLanguage,
} from "../../../../shared/thinking-language";
import { t } from "@renderer/i18n";

const emit = defineEmits<{ open: [id: string] }>();

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

const rows = [
  { id: "notify", icon: "notify", label: t.notifyTitle, description: t.customizeNotifyDesc },
  { id: "voice", icon: "voice", label: t.voiceTitle, description: t.customizeVoiceDesc },
  { id: "security", icon: "security", label: t.securityTitle, description: t.customizeSecurityDesc },
  { id: "proxy", icon: "proxy", label: t.proxyTitle, description: t.customizeProxyDesc },
  { id: "lan", icon: "lan", label: t.lanConsoleTitle, description: t.customizeLanDesc },
] as const;

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
  <div class="customize-general">
    <button
      v-for="row in rows"
      :key="row.id"
      type="button"
      class="ai-customization-list-item"
      @click="emit('open', row.id)"
    >
      <div class="item-left">
        <span class="item-icon"><CodiconIcon :name="row.icon" :size="16" /></span>
        <div class="item-text">
          <div class="item-name-row">
            <span class="item-name">{{ row.label }}</span>
          </div>
          <div class="item-description">{{ row.description }}</div>
        </div>
      </div>
      <div class="item-right">
        <span class="item-chevron"><CodiconIcon name="chevronRight" :size="14" /></span>
      </div>
    </button>

    <NDivider style="margin: 14px 0" />

    <div class="general-block">
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

    <div class="general-switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.showCompactButton }}</NText>
        <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
          {{ t.showCompactButtonHint }}
        </NText>
      </div>
      <NSwitch v-model:value="showCompactButton" />
    </div>

    <div class="general-switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.truncateToolOutput }}</NText>
        <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
          {{ t.truncateToolOutputHint }}
        </NText>
      </div>
      <NSwitch v-model:value="truncateToolOutput" />
    </div>
  </div>
</template>

<style scoped>
.customize-general {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-top: 8px;
}

.ai-customization-list-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 32px;
  margin: 0;
  padding: 6px 12px 6px 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ai-customization-list-item:hover {
  background-color: var(--bg-hover);
}

.item-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 10px;
  overflow: hidden;
}

.item-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  opacity: 0.85;
}

.item-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.item-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.item-name {
  color: var(--fg);
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-description {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 16px;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.ai-customization-list-item:hover .item-right {
  opacity: 1;
}

.general-switch-row {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
}

.general-block {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 8px 16px;
}

.switch-labels {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.item-chevron {
  display: flex;
  align-items: center;
  color: var(--fg-muted);
}
</style>
