<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NIcon, NTag, NText } from "naive-ui";
import { ChevronDownOutline, ChevronForwardOutline, DocumentTextOutline } from "@vicons/ionicons5";
import type { FileToolCard } from "@renderer/utils/tool-diff";
import { t } from "@renderer/i18n";

const props = defineProps<{
  card: FileToolCard;
  statusLabel: string;
  statusType: "default" | "success" | "error" | "info";
  toolName: string;
  streaming?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();

const open = ref(false);

const fileName = computed(() => {
  const p = props.card.path;
  if (!p) return props.toolName;
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
});

const actionLabel = computed(() => {
  if (props.card.kind === "write") return t.toolWrite;
  if (props.card.kind === "edit") return t.toolEdit;
  return props.toolName;
});
</script>

<template>
  <div class="tool-file" :class="{ streaming }">
    <button type="button" class="tool-file-head" @click="open = !open">
      <NIcon
        class="chev"
        :component="open ? ChevronDownOutline : ChevronForwardOutline"
        :size="12"
      />
      <NText code class="tool-name">{{ actionLabel }}</NText>
      <span class="path" :title="card.path ?? undefined">{{ fileName }}</span>
      <span v-if="card.stats" class="stats">
        <span class="add">+{{ card.stats.additions }}</span>
        <span class="del">-{{ card.stats.deletions }}</span>
      </span>
      <NTag size="tiny" :type="statusType" :bordered="false">{{ statusLabel }}</NTag>
      <NButton
        v-if="card.path"
        size="tiny"
        quaternary
        class="open-btn"
        :title="t.previewFile"
        @click.stop="emit('open', card.path!)"
      >
        <template #icon>
          <NIcon :component="DocumentTextOutline" :size="12" />
        </template>
      </NButton>
    </button>
    <pre v-if="open && card.diff" class="tool-diff"><code><span
      v-for="(line, i) in card.diff.split('\n')"
      :key="i"
      class="dline"
      :class="{
        add: line.startsWith('+') && !line.startsWith('+++'),
        del: line.startsWith('-') && !line.startsWith('---'),
        meta: line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'),
      }"
    >{{ line || ' ' }}</span></code></pre>
    <pre v-else-if="open && !card.diff" class="tool-diff empty">{{ t.toolNoDiff }}</pre>
  </div>
</template>

<style scoped>
.tool-file {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--tool-bg, var(--bg-elevated));
  overflow: hidden;
}

.tool-file.streaming {
  opacity: 0.85;
}

.tool-file-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 5px 8px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.tool-file-head:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.06));
}

.chev {
  flex-shrink: 0;
  color: var(--fg-muted);
}

.tool-name {
  flex-shrink: 0;
  font-size: 11px !important;
}

.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: ui-monospace, Cascadia Code, Consolas, monospace;
}

.stats {
  flex-shrink: 0;
  display: inline-flex;
  gap: 6px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, Cascadia Code, Consolas, monospace;
}

.add {
  color: #16a34a;
}

.del {
  color: #dc2626;
}

.open-btn {
  width: 22px !important;
  height: 22px !important;
  min-width: 22px !important;
  padding: 0 !important;
}

.tool-diff {
  margin: 0;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--border);
  max-height: 280px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.45;
  font-family: ui-monospace, Cascadia Code, Consolas, monospace;
  background: var(--bg, transparent);
}

.tool-diff.empty {
  color: var(--fg-muted);
}

.dline {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
}

.dline.add {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}

.dline.del {
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
}

.dline.meta {
  color: var(--fg-muted);
}
</style>
