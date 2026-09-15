<script setup lang="ts">
import { NIcon } from "naive-ui";
import { ChevronDownOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import { t } from "@renderer/i18n";
import type { TurnFileChanges } from "@renderer/utils/turn-file-changes";

defineProps<{ changes: TurnFileChanges; open: boolean }>();

const emit = defineEmits<{
  toggle: [];
  openFile: [path: string];
}>();

/** 目录与文件名分开渲染：目录从左侧省略，文件名始终可见。 */
function splitPath(path: string): { dir: string; name: string } {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0
    ? { dir: norm.slice(0, idx + 1), name: norm.slice(idx + 1) }
    : { dir: "", name: norm };
}
</script>

<template>
  <div class="turn-diff">
    <button
      type="button"
      class="td-head pi-interactive"
      :aria-expanded="open"
      @click="emit('toggle')"
    >
      <NIcon
        :component="open ? ChevronDownOutline : ChevronForwardOutline"
        :size="13"
        class="td-chev"
      />
      <span class="td-label">{{ t.filesChangedCount(changes.files.length) }}</span>
      <span class="td-nums">
        <span class="td-add">+{{ changes.totalAdditions }}</span>
        <span class="td-del">−{{ changes.totalDeletions }}</span>
      </span>
    </button>
    <ul v-if="open" class="td-files">
      <li
        v-for="file in changes.files"
        :key="file.path"
        class="td-file-row"
        :title="file.path"
        @click="emit('openFile', file.path)"
      >
        <span class="td-file">
          <span class="td-dir">{{ splitPath(file.path).dir }}</span>
          <span class="td-name">{{ splitPath(file.path).name }}</span>
        </span>
        <span class="td-add">+{{ file.additions }}</span>
        <span class="td-del">−{{ file.deletions }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.turn-diff {
  width: 100%;
  margin-top: 4px;
}

.td-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.td-head:hover {
  background: color-mix(in srgb, var(--fg) 4%, transparent);
  color: var(--fg);
}

.td-chev {
  flex-shrink: 0;
  color: var(--fg-faint);
}

.td-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.td-nums,
.td-add,
.td-del {
  flex-shrink: 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.td-nums {
  display: inline-flex;
  gap: 6px;
}

.td-add {
  color: var(--git-u, var(--success, var(--green)));
}

.td-del {
  color: var(--git-d, var(--red, #ef4444));
}

.td-files {
  list-style: none;
  margin: 2px 0 0;
  padding: 0 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.td-file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.td-file-row:hover {
  background: var(--bg-hover);
}

.td-file {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  overflow: hidden;
  white-space: nowrap;
  direction: ltr;
  unicode-bidi: isolate;
}

.td-dir {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: var(--fg-faint);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
}

.td-name {
  flex-shrink: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-strong);
}
</style>
