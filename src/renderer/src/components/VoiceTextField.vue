<script setup lang="ts">
/** NInput + FieldVoiceButton: speech appends into the field, then focus returns. */
import { nextTick, ref } from "vue";
import { NInput } from "naive-ui";
import type { InputInst } from "naive-ui";
import FieldVoiceButton from "@renderer/components/FieldVoiceButton.vue";

const props = withDefaults(
  defineProps<{
    value: string;
    placeholder?: string;
    disabled?: boolean;
    type?: "text" | "textarea";
    rows?: number;
    autosize?: boolean | { minRows?: number; maxRows?: number };
    round?: boolean;
    size?: "tiny" | "small" | "medium" | "large";
  }>(),
  {
    type: "text",
    size: "small",
  },
);

const emit = defineEmits<{
  "update:value": [value: string];
  keydown: [event: KeyboardEvent];
}>();

const inputRef = ref<InputInst | null>(null);

function joinAsr(base: string, next: string): string {
  const a = base.replace(/\s+$/u, "");
  const b = next.replace(/^\s+/u, "").trim();
  if (!b) return a;
  if (!a) return b;
  if (b.startsWith(a)) return b;
  if (a.endsWith(b)) return a;
  const needSpace =
    !/[\s\u3000]$/u.test(a) && !/^[,.!?;:\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A]/.test(b);
  return needSpace ? `${a} ${b}` : `${a}${b}`;
}

function onVoiceText(text: string): void {
  emit("update:value", joinAsr(props.value, text));
}

async function onVoiceDone(): Promise<void> {
  await nextTick();
  inputRef.value?.focus();
}

defineExpose({
  focus: () => inputRef.value?.focus(),
});
</script>

<template>
  <div class="voice-text-field">
    <NInput
      ref="inputRef"
      class="field-input"
      :value="value"
      :type="type"
      :rows="rows"
      :autosize="autosize"
      :placeholder="placeholder"
      :disabled="disabled"
      :round="round"
      :size="size"
      @update:value="(v) => emit('update:value', v)"
      @keydown="(e: KeyboardEvent) => emit('keydown', e)"
    />
    <FieldVoiceButton
      class="voice-btn"
      :disabled="disabled"
      @text="onVoiceText"
      @done="() => void onVoiceDone()"
    />
  </div>
</template>

<style scoped>
.voice-text-field {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
}

.field-input {
  flex: 1;
  min-width: 0;
}

.voice-btn {
  flex-shrink: 0;
  margin-top: 4px;
}

.voice-text-field :deep(textarea) {
  padding-right: 8px;
}
</style>
