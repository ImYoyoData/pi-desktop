<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NIcon, NText } from "naive-ui";
import { CheckmarkOutline, CloseOutline, ExtensionPuzzleOutline } from "@vicons/ionicons5";
import type { ExtensionUiPending } from "../../../shared/extension-ui";
import { t } from "@renderer/i18n";
import { useChatStore } from "@renderer/stores/chat";
import VoiceTextField from "@renderer/components/VoiceTextField.vue";

const chat = useChatStore();
const replying = ref(false);
const textDraft = ref("");
const selectedOption = ref<string | null>(null);

const prompt = computed(() => chat.activePendingExtensionUi);

watch(
  prompt,
  (p) => {
    replying.value = false;
    selectedOption.value = null;
    if (p?.method === "input") {
      textDraft.value = "";
    } else if (p?.method === "editor") {
      textDraft.value = p.prefill ?? "";
    } else {
      textDraft.value = "";
    }
  },
  { immediate: true },
);

async function reply(body: Parameters<typeof chat.replyExtensionUi>[0]): Promise<void> {
  if (replying.value) return;
  replying.value = true;
  try {
    await chat.replyExtensionUi(body);
  } finally {
    replying.value = false;
  }
}

async function onCancel(p: ExtensionUiPending): Promise<void> {
  await reply({ requestId: p.requestId, cancelled: true });
}

async function onConfirmYes(p: Extract<ExtensionUiPending, { method: "confirm" }>): Promise<void> {
  await reply({ requestId: p.requestId, confirmed: true });
}

async function onConfirmNo(p: Extract<ExtensionUiPending, { method: "confirm" }>): Promise<void> {
  await reply({ requestId: p.requestId, confirmed: false });
}

async function onSelect(p: Extract<ExtensionUiPending, { method: "select" }>, value: string): Promise<void> {
  selectedOption.value = value;
  await reply({ requestId: p.requestId, value });
}

async function onSubmitText(
  p: Extract<ExtensionUiPending, { method: "input" | "editor" }>,
): Promise<void> {
  const value = textDraft.value;
  await reply({ requestId: p.requestId, value });
}
</script>

<template>
  <div v-if="prompt" class="ext-ui-wrap">
    <div class="ext-ui-card" role="dialog" :aria-label="t.extensionUiTitle">
      <header class="strip-head">
        <div class="head-badge" aria-hidden="true">
          <NIcon :component="ExtensionPuzzleOutline" :size="16" />
        </div>
        <div class="head-text">
          <div class="head-title">{{ t.extensionUiTitle }}</div>
          <div class="head-sub">{{ prompt.title }}</div>
        </div>
      </header>

      <div v-if="prompt.method === 'confirm'" class="strip-body">
        <NText depth="3" class="message">{{ prompt.message }}</NText>
        <footer class="strip-foot">
          <NButton round class="pi-interactive" :disabled="replying" @click="onCancel(prompt)">
            {{ t.extensionUiCancel }}
          </NButton>
          <NButton round class="pi-interactive" :disabled="replying" @click="onConfirmNo(prompt)">
            {{ t.extensionUiNo }}
          </NButton>
          <NButton
            type="primary"
            round
            class="pi-interactive"
            :disabled="replying"
            :loading="replying"
            @click="onConfirmYes(prompt)"
          >
            <template #icon>
              <NIcon :component="CheckmarkOutline" />
            </template>
            {{ t.extensionUiYes }}
          </NButton>
        </footer>
      </div>

      <div v-else-if="prompt.method === 'select'" class="strip-body">
        <div class="opt-list">
          <button
            v-for="opt in prompt.options"
            :key="opt"
            type="button"
            class="opt-chip pi-interactive"
            :class="{ active: selectedOption === opt }"
            :disabled="replying"
            @click="onSelect(prompt, opt)"
          >
            {{ opt }}
          </button>
        </div>
        <footer class="strip-foot">
          <NButton round class="pi-interactive" :disabled="replying" @click="onCancel(prompt)">
            <template #icon>
              <NIcon :component="CloseOutline" />
            </template>
            {{ t.extensionUiCancel }}
          </NButton>
        </footer>
      </div>

      <div v-else-if="prompt.method === 'input' || prompt.method === 'editor'" class="strip-body">
        <VoiceTextField
          v-if="prompt.method === 'input'"
          :value="textDraft"
          size="small"
          :placeholder="prompt.placeholder || t.extensionUiInputPlaceholder"
          :disabled="replying"
          @update:value="(v) => (textDraft = v)"
          @keydown="(e) => e.key === 'Enter' && (e.preventDefault(), onSubmitText(prompt))"
        />
        <VoiceTextField
          v-else
          :value="textDraft"
          type="textarea"
          :rows="4"
          size="small"
          :placeholder="t.extensionUiEditorPlaceholder"
          :disabled="replying"
          @update:value="(v) => (textDraft = v)"
        />
        <footer class="strip-foot">
          <NButton round class="pi-interactive" :disabled="replying" @click="onCancel(prompt)">
            {{ t.extensionUiCancel }}
          </NButton>
          <NButton
            type="primary"
            round
            class="pi-interactive"
            :disabled="replying"
            :loading="replying"
            @click="onSubmitText(prompt)"
          >
            {{ t.extensionUiSubmit }}
          </NButton>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ext-ui-wrap {
  flex-shrink: 0;
  padding: 0 12px 8px;
}

.ext-ui-card {
  border: 1px solid color-mix(in srgb, var(--primary, #3b82f6) 28%, var(--border, #ddd));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-elevated, #fff) 94%, var(--primary, #3b82f6) 6%);
  overflow: hidden;
}

.strip-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 6px;
}

.head-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--primary, #3b82f6) 16%, transparent);
  color: var(--primary, #3b82f6);
}

.head-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--fg-strong, #111);
}

.head-sub {
  font-size: 12px;
  color: var(--fg-muted, #555);
  line-height: 1.35;
}

.strip-body {
  padding: 4px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message {
  font-size: 12.5px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.opt-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.opt-chip {
  margin: 0;
  padding: 5px 12px;
  border: 1px solid var(--border, #ddd);
  border-radius: 999px;
  background: var(--bg, #fff);
  color: var(--fg, #222);
  font-size: 12px;
  cursor: pointer;
}

.opt-chip:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary, #3b82f6) 50%, var(--border));
}

.opt-chip.active {
  border-color: var(--primary, #3b82f6);
  background: color-mix(in srgb, var(--primary, #3b82f6) 14%, transparent);
  color: var(--primary, #3b82f6);
}

.strip-foot {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
