<script setup lang="ts">
import { computed } from "vue";
import FileTypeIcon from "@renderer/components/FileTypeIcon.vue";

const props = defineProps<{
  path: string;
  /** Override the visible label (defaults to the basename). */
  label?: string;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();

const fileName = computed(() => {
  const parts = props.path.split(/[/\\]/);
  return parts[parts.length - 1] || props.path;
});

function onClick(event: MouseEvent): void {
  event.stopPropagation();
  emit("open", props.path);
}
</script>

<template>
  <button
    type="button"
    class="file-chip"
    :title="path"
    @click="onClick"
    @keydown.enter.stop="emit('open', path)"
  >
    <FileTypeIcon :path="path" :size="12" class="file-chip-icon" />
    <span class="file-chip-label">{{ label ?? fileName }}</span>
  </button>
</template>

<style scoped>
/* 1:1 with VS Code .chat-inline-anchor-widget (chatInlineAnchorWidget.css) */
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  width: fit-content;
  max-width: 100%;
  margin: 0 1px;
  padding: 1px 3px;
  border: 0.5px solid var(--chat-line, var(--border));
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--chat-font-s, 12px);
  line-height: 1.5;
  text-wrap: nowrap;
  cursor: pointer;
  vertical-align: baseline;
}

.file-chip:hover {
  background-color: var(--chat-hover-bg, rgba(127, 127, 127, 0.1));
}

.file-chip-label {
  padding: 0 3px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--chat-font-xs, 11px);
}
</style>
