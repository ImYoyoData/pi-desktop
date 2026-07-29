<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NText } from "naive-ui";
import { t } from "@renderer/i18n";
import {
  applyConflictChoices,
  conflictIds,
  parseConflictMarkers,
  previewConflictContent,
  type ConflictChoice,
  type ConflictSegment,
} from "@renderer/utils/conflict-markers";

const props = defineProps<{
  filePath: string;
  working: string;
  labels: { ours: string; theirs: string };
}>();

const emit = defineEmits<{
  resolve: [content: string];
  "accept-side": [side: "ours" | "theirs"];
}>();

type ParseState =
  | { kind: "no_markers" }
  | { kind: "malformed" }
  | { kind: "ok"; segments: ConflictSegment[]; ids: number[] };

const parseState = ref<ParseState>({ kind: "no_markers" });
const choices = ref<Record<number, ConflictChoice>>({});
const activeId = ref<number | null>(null);

function reparse(working: string): void {
  const result = parseConflictMarkers(working);
  if (!result.ok) {
    parseState.value = { kind: result.reason };
    choices.value = {};
    activeId.value = null;
    return;
  }
  const ids = conflictIds(result.segments);
  const next: Record<number, ConflictChoice> = {};
  for (const id of ids) next[id] = "unset";
  choices.value = next;
  activeId.value = ids[0] ?? null;
  parseState.value = { kind: "ok", segments: result.segments, ids };
}

watch(
  () => props.working,
  (working) => reparse(working),
  { immediate: true },
);

const isOk = computed(() => parseState.value.kind === "ok");

const hintMessage = computed(() => {
  if (parseState.value.kind === "no_markers") return t.changesConflictNoMarkers;
  if (parseState.value.kind === "malformed") return t.changesConflictMalformed;
  return null;
});

const previewText = computed(() => {
  if (parseState.value.kind !== "ok") return props.working;
  return previewConflictContent(parseState.value.segments, choices.value);
});

const canConfirm = computed(() => {
  if (parseState.value.kind !== "ok") return false;
  return applyConflictChoices(parseState.value.segments, choices.value) !== null;
});

const blockLabel = computed(() => {
  if (parseState.value.kind !== "ok" || activeId.value === null) return "";
  const idx = parseState.value.ids.indexOf(activeId.value);
  if (idx < 0) return "";
  return t.changesConflictBlock(idx + 1, parseState.value.ids.length);
});

const canPrev = computed(() => {
  if (parseState.value.kind !== "ok" || activeId.value === null) return false;
  return parseState.value.ids.indexOf(activeId.value) > 0;
});

const canNext = computed(() => {
  if (parseState.value.kind !== "ok" || activeId.value === null) return false;
  const idx = parseState.value.ids.indexOf(activeId.value);
  return idx >= 0 && idx < parseState.value.ids.length - 1;
});

function setActiveChoice(side: "ours" | "theirs"): void {
  if (activeId.value === null) return;
  choices.value = { ...choices.value, [activeId.value]: side };
}

function onAcceptSide(side: "ours" | "theirs"): void {
  emit("accept-side", side);
}

function onConfirm(): void {
  if (parseState.value.kind !== "ok") return;
  const content = applyConflictChoices(parseState.value.segments, choices.value);
  if (content !== null) emit("resolve", content);
}

function prevBlock(): void {
  if (parseState.value.kind !== "ok" || activeId.value === null) return;
  const idx = parseState.value.ids.indexOf(activeId.value);
  if (idx > 0) activeId.value = parseState.value.ids[idx - 1]!;
}

function nextBlock(): void {
  if (parseState.value.kind !== "ok" || activeId.value === null) return;
  const idx = parseState.value.ids.indexOf(activeId.value);
  if (idx >= 0 && idx < parseState.value.ids.length - 1) {
    activeId.value = parseState.value.ids[idx + 1]!;
  }
}
</script>

<template>
  <div class="conflict-resolve">
    <div class="conflict-head">
      <NText depth="2" class="conflict-path">{{ filePath }}</NText>
      <span v-if="isOk" class="block-tag">{{ blockLabel }}</span>
    </div>

    <p v-if="hintMessage" class="conflict-hint">{{ hintMessage }}</p>

    <div class="conflict-toolbar">
      <NButton class="tool-btn" size="tiny" quaternary @click="onAcceptSide('ours')">
        {{ t.changesConflictAllOurs }}
      </NButton>
      <NButton class="tool-btn" size="tiny" quaternary @click="onAcceptSide('theirs')">
        {{ t.changesConflictAllTheirs }}
      </NButton>
      <template v-if="isOk">
        <span class="toolbar-sep" />
        <NButton class="tool-btn" size="tiny" quaternary :disabled="!canPrev" @click="prevBlock">
          {{ t.changesConflictPrev }}
        </NButton>
        <NButton class="tool-btn" size="tiny" quaternary :disabled="!canNext" @click="nextBlock">
          {{ t.changesConflictNext }}
        </NButton>
        <NButton class="tool-btn" size="tiny" quaternary @click="setActiveChoice('ours')">
          {{ t.changesConflictAcceptOurs }} ({{ labels.ours }})
        </NButton>
        <NButton class="tool-btn" size="tiny" quaternary @click="setActiveChoice('theirs')">
          {{ t.changesConflictAcceptTheirs }} ({{ labels.theirs }})
        </NButton>
        <span class="spacer" />
        <NButton class="tool-btn" size="tiny" type="primary" :disabled="!canConfirm" @click="onConfirm">
          {{ t.changesConflictConfirm }}
        </NButton>
      </template>
    </div>

    <pre class="conflict-preview">{{ previewText }}</pre>
  </div>
</template>

<style scoped>
.conflict-resolve {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}

.conflict-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.conflict-path {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block-tag {
  font-size: 11px;
  color: var(--fg);
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.conflict-hint {
  margin: 0;
  padding: 6px 10px;
  font-size: 12px;
  color: #8a1f1f;
  background: color-mix(in srgb, #cf222e 12%, var(--bg));
  border-bottom: 1px solid color-mix(in srgb, #cf222e 28%, var(--border));
  flex-shrink: 0;
}

.conflict-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tool-btn {
  font-size: 12px;
}

.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 2px;
}

.spacer {
  flex: 1;
  min-width: 4px;
}

.conflict-preview {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.45;
  font-family: ui-monospace, monospace;
  color: var(--fg);
  background: var(--bg);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
