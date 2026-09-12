<script setup lang="ts">
import { computed, ref } from "vue";
import { NIcon } from "naive-ui";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  CreateOutline,
  DocumentTextOutline,
} from "@vicons/ionicons5";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useLayoutStore } from "@renderer/stores/layout";
import { useSessionFileChanges } from "@renderer/utils/use-session-file-changes";
import { t } from "@renderer/i18n";

/**
 * Copilot chat-editing "working set" — files the agent touched this session,
 * docked on the chat input stack above the composer. Header shows "<N> files
 * changed" + an aggregate +added/-removed pill (Copilot `.working-set-title`
 * + `.working-set-line-counts`); expanding lists every path with its own
 * +/- counts; clicking a row previews the file.
 *
 * Row data (transcript aggregate merged with the real net per-file stats)
 * comes from `useSessionFileChanges`, shared with the right-pane Changes
 * dock view.
 */

const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const layout = useLayoutStore();

const { files } = useSessionFileChanges();

const collapsed = ref(true);

const totalAdditions = computed(() =>
  files.value.reduce((n, f) => n + f.additions, 0),
);
const totalDeletions = computed(() =>
  files.value.reduce((n, f) => n + f.deletions, 0),
);

const title = computed(() =>
  filesChangedLabel(files.value.length),
);

function filesChangedLabel(n: number): string {
  return n === 0 ? t.filesChanged : t.filesChangedCount(n);
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

function toggle(): void {
  collapsed.value = !collapsed.value;
}

function openFile(p: string): void {
  previewStore.openPreview(p);
  rightTabs.addTab("preview", {
    filePath: p,
    label: basename(p),
  });
  if (layout.rightCollapsed) layout.toggleRightCollapsed();
}
</script>

<template>
  <div
    v-if="files.length"
    class="files-dock"
    role="region"
    :aria-label="title"
    :class="{ expanded: !collapsed }"
  >
    <div class="files-dock-head">
      <button
        type="button"
        class="files-dock-toggle pi-interactive"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? t.filesExpand : t.filesCollapse"
        @click="toggle"
      >
        <NIcon
          class="chev"
          :component="collapsed ? ChevronForwardOutline : ChevronDownOutline"
          :size="13"
          aria-hidden="true"
        />
        <NIcon
          v-if="!collapsed"
          class="files-head-icon"
          :component="CreateOutline"
          :size="13"
          aria-hidden="true"
        />
        <span class="files-title">{{ title }}</span>
        <span
          v-if="totalAdditions || totalDeletions"
          class="files-line-counts"
        >
          <span v-if="totalAdditions" class="lines-added">
            +{{ totalAdditions }}
          </span>
          <span v-if="totalDeletions" class="lines-removed">
            -{{ totalDeletions }}
          </span>
        </span>
      </button>
    </div>

    <Transition name="files-expand">
      <div v-show="!collapsed" class="files-dock-body">
        <ul class="files-list" role="list">
          <li
            v-for="f in files"
            :key="f.path"
            class="files-item"
            role="listitem"
            @click="openFile(f.path)"
          >
            <NIcon
              class="file-glyph"
              :component="DocumentTextOutline"
              :size="14"
              aria-hidden="true"
            />
            <span class="file-path" :title="f.path">{{ basename(f.path) }}</span>
            <span class="files-item-counts">
              <span v-if="f.additions" class="lines-added">+{{ f.additions }}</span>
              <span v-if="f.deletions" class="lines-removed">-{{ f.deletions }}</span>
            </span>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Copilot chat-editing working set — docked slice on the input
   stack. Border/radius come from the enclosing .chat-input-stack. */

.files-dock {
  flex-shrink: 0;
  min-width: 0;
  background: transparent;
}

.files-dock-head {
  display: flex;
  align-items: center;
}

.files-dock-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px 0 2px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  font: inherit;
  user-select: none;
}

.files-dock-toggle:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.chev {
  flex-shrink: 0;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.files-head-icon {
  flex-shrink: 0;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.files-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--chat-font-s, 12px);
  font-weight: 500;
  line-height: 22px;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.files-dock-toggle:hover .files-title {
  color: var(--fg);
}

.files-line-counts {
  flex-shrink: 0;
  display: inline-flex;
  gap: 3px;
  margin-right: 6px;
  font-size: var(--chat-font-xs, 11px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.lines-added {
  color: var(--git-u, var(--success, var(--green)));
}

.lines-removed {
  color: var(--git-d, var(--red, #ef4444));
}

.files-dock-body {
  min-width: 0;
  padding: 0 6px 6px;
}

.files-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 198px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong, var(--border)) transparent;
}

.files-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: var(--chat-font-s, 12px);
  color: var(--fg);
  cursor: pointer;
}

.files-item:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.file-glyph {
  flex-shrink: 0;
  color: var(--chat-icon-fg, var(--fg-muted));
}

.file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-item-counts {
  flex-shrink: 0;
  display: inline-flex;
  gap: 3px;
  margin-right: 4px;
  font-size: var(--chat-font-xs, 11px);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.files-expand-enter-active,
.files-expand-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
  overflow: hidden;
}

.files-expand-enter-from,
.files-expand-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {
  .files-expand-enter-active,
  .files-expand-leave-active {
    transition: none;
  }
}
</style>
