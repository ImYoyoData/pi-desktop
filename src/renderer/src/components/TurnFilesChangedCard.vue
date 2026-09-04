<script setup lang="ts">
import { computed } from "vue";
import type { TurnFileChanges } from "@renderer/utils/turn-file-changes";
import { t } from "@renderer/i18n";

const props = defineProps<{
  changes: TurnFileChanges;
  /** How many file rows to show before “show more”. */
  previewCount?: number;
  showAll?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
  review: [];
  toggleMore: [];
}>();

const preview = computed(() => Math.max(1, props.previewCount ?? 3));

const visibleFiles = computed(() => {
  const files = props.changes.files;
  if (props.showAll || files.length <= preview.value) return files;
  return files.slice(0, preview.value);
});

const hiddenCount = computed(() =>
  Math.max(0, props.changes.files.length - preview.value),
);

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function extLabel(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "•";
  return name.slice(i + 1).slice(0, 3).toLowerCase();
}

function extTone(path: string): string {
  const ext = extLabel(path);
  switch (ext) {
    case "vue":
      return "vue";
    case "ts":
    case "tsx":
      return "ts";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "js";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "json":
      return "json";
    case "md":
    case "mdx":
      return "md";
    case "go":
      return "go";
    case "py":
      return "py";
    case "rs":
      return "rs";
    default:
      return "default";
  }
}
</script>

<template>
  <div class="tfc-card">
    <div class="tfc-head">
      <span class="tfc-title">{{ t.filesChanged(changes.files.length) }}</span>
      <button type="button" class="tfc-review" @click="emit('review')">
        {{ t.reviewChanges }}
      </button>
    </div>
    <ul class="tfc-files">
      <li
        v-for="f in visibleFiles"
        :key="f.path"
        class="tfc-row"
        :title="f.path"
        @click="emit('open', f.path)"
      >
        <span class="tfc-ext" :data-tone="extTone(f.path)">{{ extLabel(f.path) }}</span>
        <span class="tfc-name">{{ basename(f.path) }}</span>
        <span class="tfc-stats">
          <span v-if="f.additions > 0" class="tfc-add">+{{ f.additions }}</span>
          <span v-if="f.deletions > 0" class="tfc-del">−{{ f.deletions }}</span>
        </span>
      </li>
    </ul>
    <button
      v-if="changes.files.length > preview"
      type="button"
      class="tfc-more"
      @click="emit('toggleMore')"
    >
      {{
        showAll
          ? t.showLessFiles
          : t.showMoreFiles(hiddenCount)
      }}
    </button>
  </div>
</template>

<style scoped>
.tfc-card {
  width: 100%;
  margin-top: 10px;
  padding: 10px 12px 8px;
  border: 1px solid color-mix(in srgb, var(--border, #d0d7de) 90%, transparent);
  border-radius: 10px;
  background: var(--bg-panel, var(--bg, #fff));
  box-sizing: border-box;
}

html[data-theme="dark"] .tfc-card {
  border-color: color-mix(in srgb, var(--border, #30363d) 85%, transparent);
  background: color-mix(in srgb, var(--bg-panel, #161b22) 92%, transparent);
}

.tfc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.tfc-title {
  font-size: 12px;
  font-weight: 600;
  color: #5c6570;
}

html[data-theme="dark"] .tfc-title {
  color: #9aa3b2;
}

.tfc-review {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: #6e7681;
  cursor: pointer;
}

.tfc-review:hover {
  color: var(--accent, #0969da);
}

html[data-theme="dark"] .tfc-review {
  color: #8b949e;
}

html[data-theme="dark"] .tfc-review:hover {
  color: #58a6ff;
}

.tfc-files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tfc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 4px 8px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--bg-muted, #f3f4f6) 88%, transparent);
  cursor: pointer;
}

.tfc-row:hover {
  background: color-mix(in srgb, var(--bg-muted, #eef0f3) 100%, transparent);
}

html[data-theme="dark"] .tfc-row {
  background: color-mix(in srgb, #21262d 90%, transparent);
}

html[data-theme="dark"] .tfc-row:hover {
  background: #30363d;
}

.tfc-ext {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 16px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  color: #fff;
  background: #6e7681;
}

.tfc-ext[data-tone="vue"] {
  background: #42b883;
}

.tfc-ext[data-tone="ts"] {
  background: #3178c6;
}

.tfc-ext[data-tone="js"] {
  background: #c4a000;
  color: #1a1a1a;
}

.tfc-ext[data-tone="css"] {
  background: #563d7c;
}

.tfc-ext[data-tone="json"] {
  background: #6b7280;
}

.tfc-ext[data-tone="md"] {
  background: #0ea5e9;
}

.tfc-ext[data-tone="go"] {
  background: #00add8;
}

.tfc-ext[data-tone="py"] {
  background: #3776ab;
}

.tfc-ext[data-tone="rs"] {
  background: #dea584;
  color: #1a1a1a;
}

.tfc-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg, #24292f);
}

html[data-theme="dark"] .tfc-name {
  color: #e6edf3;
}

.tfc-stats {
  flex-shrink: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tfc-add {
  color: #1a7f37;
}

.tfc-del {
  color: #cf222e;
}

html[data-theme="dark"] .tfc-add {
  color: #3fb950;
}

html[data-theme="dark"] .tfc-del {
  color: #f85149;
}

.tfc-more {
  margin: 6px 0 0;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  color: #6e7681;
  cursor: pointer;
}

.tfc-more:hover {
  color: var(--accent, #0969da);
}
</style>
