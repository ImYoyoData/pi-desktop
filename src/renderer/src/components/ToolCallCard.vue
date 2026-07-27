<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NIcon, NTag, NText } from "naive-ui";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  DocumentTextOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import type { ToolCard } from "@renderer/utils/tool-diff";
import { t } from "@renderer/i18n";

const props = defineProps<{
  card: ToolCard;
  toolName: string;
  order?: number;
  statusLabel: string;
  statusType: "default" | "success" | "error" | "info";
  streaming?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();

const open = ref(false);

const fileName = computed(() => {
  if (props.card.kind === "bash" || props.card.kind === "generic") return null;
  const p = props.card.path;
  if (!p) return null;
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
});

const actionLabel = computed(() => {
  switch (props.card.kind) {
    case "write":
      return t.toolWrite;
    case "edit":
      return t.toolEdit;
    case "read":
      return t.toolRead;
    case "bash":
      return t.toolBash;
    case "generic":
      return props.toolName;
    case "other":
      return props.toolName;
    default: {
      const _never: never = props.card;
      return String(_never);
    }
  }
});

const metaLine = computed(() => {
  const card = props.card;
  if (card.kind === "read") {
    if (card.linesRead != null && card.totalLines != null) {
      return t.toolLinesRead(card.linesRead, card.totalLines);
    }
    if (card.linesRead != null) return t.toolLinesOf(card.linesRead);
    return null;
  }
  if (card.kind === "bash") {
    if (card.linesRead != null && card.totalLines != null) {
      return t.toolLinesRead(card.linesRead, card.totalLines);
    }
    if (card.linesRead != null) return t.toolLinesOf(card.linesRead);
    return null;
  }
  if ((card.kind === "edit" || card.kind === "write") && card.stats) {
    return `+${card.stats.additions} -${card.stats.deletions}`;
  }
  return null;
});

const headline = computed(() => {
  const card = props.card;
  if (card.kind === "bash") return card.command || props.toolName;
  if (card.kind === "generic") return card.summary || props.toolName;
  return fileName.value || props.toolName;
});

const body = computed(() => {
  const card = props.card;
  if (card.kind === "edit" || card.kind === "write" || card.kind === "other") {
    return card.diff;
  }
  return card.preview;
});

const pathTitle = computed(() => {
  if (props.card.kind === "bash" || props.card.kind === "generic") return undefined;
  return props.card.path ?? undefined;
});

const canPreviewPath = computed(() => {
  const card = props.card;
  return (
    (card.kind === "read" ||
      card.kind === "edit" ||
      card.kind === "write" ||
      card.kind === "other") &&
    Boolean(card.path)
  );
});

function onOpenPreview(): void {
  const card = props.card;
  if (
    card.kind === "read" ||
    card.kind === "edit" ||
    card.kind === "write" ||
    card.kind === "other"
  ) {
    if (card.path) emit("open", card.path);
  }
}
</script>

<template>
  <div class="tool-call" :class="{ streaming, error: statusType === 'error' }">
    <button type="button" class="tool-call-head" @click="open = !open">
      <NIcon
        class="chev"
        :component="open ? ChevronDownOutline : ChevronForwardOutline"
        :size="12"
      />
      <span v-if="order != null" class="order" :title="t.toolOrderHint(order)">#{{ order }}</span>
      <NText code class="tool-name">{{ actionLabel }}</NText>
      <span class="headline" :title="pathTitle || headline">{{ headline }}</span>
      <span v-if="metaLine" class="meta" :class="{ stats: card.kind === 'edit' || card.kind === 'write' }">
        <template v-if="card.kind === 'edit' || card.kind === 'write'">
          <span v-if="card.stats" class="add">+{{ card.stats.additions }}</span>
          <span v-if="card.stats" class="del">-{{ card.stats.deletions }}</span>
        </template>
        <template v-else>{{ metaLine }}</template>
      </span>
      <span v-if="card.kind === 'read' && card.truncated" class="trunc">{{ t.toolTruncated }}</span>
      <span v-if="card.kind === 'bash' && card.truncated" class="trunc">{{ t.toolTruncated }}</span>
      <NTag size="tiny" :type="statusType" :bordered="false">{{ statusLabel }}</NTag>
      <NButton
        v-if="canPreviewPath"
        size="tiny"
        quaternary
        class="open-btn"
        :title="t.previewFile"
        @click.stop="onOpenPreview"
      >
        <template #icon>
          <NIcon :component="DocumentTextOutline" :size="12" />
        </template>
      </NButton>
      <NIcon
        v-else-if="card.kind === 'bash'"
        class="kind-icon"
        :component="TerminalOutline"
        :size="12"
      />
    </button>
    <pre v-if="open && body" class="tool-body"><code><span
      v-for="(line, i) in body.split('\n')"
      :key="i"
      class="dline"
      :class="{
        add: (card.kind === 'edit' || card.kind === 'write') && line.startsWith('+') && !line.startsWith('+++'),
        del: (card.kind === 'edit' || card.kind === 'write') && line.startsWith('-') && !line.startsWith('---'),
        meta: line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'),
      }"
    >{{ line || ' ' }}</span></code></pre>
    <pre v-else-if="open && !body" class="tool-body empty">{{ t.toolNoDiff }}</pre>
  </div>
</template>

<style scoped>
.tool-call {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--tool-bg, var(--bg-elevated));
  overflow: hidden;
}

.tool-call.streaming {
  opacity: 0.85;
}

.tool-call.error {
  border-color: color-mix(in srgb, var(--error, #d03050) 35%, var(--border));
}

.tool-call-head {
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

.tool-call-head:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.06));
}

.chev,
.kind-icon {
  flex-shrink: 0;
  color: var(--fg-muted);
}

.order {
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
  background: var(--bg-hover, rgba(127, 127, 127, 0.08));
  border-radius: 4px;
  padding: 0 5px;
  line-height: 16px;
}

.tool-name {
  flex-shrink: 0;
  font-size: 11px !important;
}

.headline {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--font-mono, ui-monospace, monospace);
}

.meta {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.meta.stats {
  display: inline-flex;
  gap: 4px;
  font-family: var(--font-mono, ui-monospace, monospace);
}

.add {
  color: #1a7f37;
}

.del {
  color: #cf222e;
}

.trunc {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--warning, #9a6700);
}

.open-btn {
  flex-shrink: 0;
}

.tool-body {
  margin: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  max-height: 280px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.45;
  font-family: var(--font-mono, ui-monospace, monospace);
  background: var(--pre-bg, rgba(0, 0, 0, 0.03));
}

.tool-body.empty {
  color: var(--fg-muted);
}

.dline {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
}

.dline.add {
  background: rgba(46, 160, 67, 0.12);
}

.dline.del {
  background: rgba(248, 81, 73, 0.12);
}

.dline.meta {
  color: var(--fg-muted);
}
</style>
