<script setup lang="ts">
import { computed } from "vue";
import { t } from "@renderer/i18n";

const props = defineProps<{
  value: boolean;
  /** 无标签时按钮固定显示「启用」，有标签时显示标签；高亮均代表已开启。 */
  label?: string;
  title?: string;
  disabled?: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{ "update:value": [value: boolean] }>();

const text = computed(() => props.label || t.enable);
const hint = computed(() => props.title || props.label || "");
</script>

<template>
  <button
    type="button"
    class="toggle-button"
    :class="{ checked: value }"
    :disabled="disabled || loading"
    :title="hint"
    :aria-pressed="value"
    @click="emit('update:value', !value)"
  >
    {{ text }}
  </button>
</template>

<style scoped>
.toggle-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11.5px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.toggle-button:hover:not(:disabled) {
  background: var(--bg-active);
  color: var(--fg);
}

.toggle-button.checked,
.toggle-button.checked:hover:not(:disabled) {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--fg-strong);
}

.toggle-button:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
