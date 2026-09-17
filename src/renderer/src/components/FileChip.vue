<script setup lang="ts">
import { computed } from "vue";
import { fileIcon } from "@renderer/utils/file-icon";

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

const glyph = computed(() => fileIcon(props.path));

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
    <span
      class="file-chip-glyph"
      :style="glyph.color ? { color: glyph.color } : undefined"
      aria-hidden="true"
    >{{ glyph.glyph }}</span>
    <span class="file-chip-label">{{ label ?? fileName }}</span>
  </button>
</template>

<style scoped>
/* 1:1 with VS Code .chat-inline-anchor-widget (chatInlineAnchorWidget.css) */
.file-chip {
  display: inline-flex;
  align-items: center;
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

/* 零宽锚点：图标字体的基线会把 FileChip 的对外基线拉低约 2px，
   用与文件名同字体同字号的锚点把基线固定回文字基线。 */
.file-chip::before {
  content: "\200B";
  flex: 0 0 auto;
  width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--chat-font-xs, 11px);
  line-height: 1.5;
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

/* Seti 字形居中于行盒，文字视觉中心偏下约 2px，下移对齐 */
.file-chip-glyph {
  flex-shrink: 0;
  margin-right: 3px;
  font-family: "seti";
  font-size: 14px;
  line-height: 1;
  transform: translateY(1px);
}
</style>
