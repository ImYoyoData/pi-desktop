<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NModal,
  NScrollbar,
  NSpin,
  NTag,
  NText,
} from "naive-ui";
import { DocumentOutline, ExtensionPuzzleOutline, FileTrayFullOutline, SparklesOutline, TerminalOutline } from "@vicons/ionicons5";
import { useChatStore } from "@renderer/stores/chat";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { parseToolCard } from "@renderer/utils/tool-diff";
import type { WorkerResourceSummary } from "../../../shared/worker-resources";
import type { SessionExtensionInfo } from "../../../shared/protocol";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean; sessionId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const chat = useChatStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();

const resources = ref<WorkerResourceSummary | null>(null);
const extensions = ref<SessionExtensionInfo[]>([]);
const loading = ref(false);

/** Files the agent read in this session (from read tool calls). */
const filesRead = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const msg of chat.activeMessages) {
    if (msg.role !== "tool") continue;
    try {
      const card = parseToolCard(msg);
      if (card.kind !== "read" || !card.path) continue;
      const p = card.path.replace(/\\/g, "/");
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    } catch {
      // ignore malformed rows
    }
  }
  return out;
});

/** Open a read file in the right-side preview tab (same as tool cards). */
function openReadFile(filePath: string): void {
  previewStore.openPreview(filePath);
  rightTabs.addTab("preview", {
    filePath,
    label: filePath.split(/[/\\]/).pop() || t.preview,
  });
}

watch(
  () => props.open,
  async (open) => {
    if (!open || !props.sessionId) return;
    loading.value = true;
    resources.value = null;
    extensions.value = [];
    try {
      const info = await window.api.sessions.getInfo(props.sessionId);
      resources.value = info.resources ?? null;
      extensions.value = info.extensions ?? [];
    } catch {
      resources.value = null;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <NModal
    :show="open"
    preset="card"
    :title="t.sessionInfoTitle"
    class="pi-settings-modal session-info-modal"
    style="width: min(680px, 94vw)"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <NText depth="3" class="info-hint">{{ t.sessionInfoHint }}</NText>
    <NSpin :show="loading" class="spin-fill">
      <NScrollbar class="info-scroll">
        <!-- Tools -->
        <section class="card">
          <div class="card-title">
            <NIcon :component="TerminalOutline" :size="15" />
            <span>{{ t.sessionInfoTools }}</span>
            <span class="count">{{ resources?.activeTools.length ?? 0 }}</span>
          </div>
          <div v-if="resources?.activeTools.length" class="chips">
            <NTag v-for="tool in resources.activeTools" :key="tool" size="small" :bordered="false" class="chip">
              {{ tool }}
            </NTag>
          </div>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </section>

        <!-- Extensions -->
        <section class="card">
          <div class="card-title">
            <NIcon :component="ExtensionPuzzleOutline" :size="15" />
            <span>{{ t.sessionInfoExtensions }}</span>
            <span class="count">{{ extensions.length }}</span>
          </div>
          <ul v-if="extensions.length" class="ext-list">
            <li v-for="ext in extensions" :key="ext.path" class="ext-row" :title="ext.path">
              <div class="ext-main">
                <span class="ext-name">{{ ext.name }}</span>
                <span v-if="ext.brief" class="ext-brief">{{ ext.brief }}</span>
              </div>
              <span class="ext-path">{{ ext.path }}</span>
            </li>
          </ul>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </section>

        <!-- Skills -->
        <section class="card">
          <div class="card-title">
            <NIcon :component="SparklesOutline" :size="15" />
            <span>{{ t.sessionInfoSkills }}</span>
            <span class="count">{{ resources?.skillNames.length ?? 0 }}</span>
          </div>
          <div v-if="resources?.skillNames.length" class="chips">
            <NTag v-for="sk in resources.skillNames" :key="sk" size="small" :bordered="false" class="chip">
              {{ sk }}
            </NTag>
          </div>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </section>

        <!-- Files read -->
        <section class="card">
          <div class="card-title">
            <NIcon :component="FileTrayFullOutline" :size="15" />
            <span>{{ t.sessionInfoFilesRead }}</span>
            <span class="count">{{ filesRead.length }}</span>
          </div>
          <ul v-if="filesRead.length" class="file-list">
            <li v-for="p in filesRead" :key="p">
              <button
                type="button"
                class="file-row"
                :title="p"
                @click="openReadFile(p)"
              >
                <NIcon :component="DocumentOutline" :size="13" class="file-icon" />
                <span class="file-path">{{ p }}</span>
              </button>
            </li>
          </ul>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </section>
      </NScrollbar>
    </NSpin>
    <template #footer>
      <div class="footer">
        <NButton size="small" @click="emit('close')">{{ t.close }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.info-hint {
  display: block;
  font-size: 12px;
  margin-bottom: 12px;
  line-height: 1.5;
}

.spin-fill {
  height: 100%;
}

.info-scroll {
  max-height: min(56vh, 460px);
  padding-right: 6px;
}

/* The NScrollbar handles scrolling; don't let the global card-content
   overflow rule add a second scrollbar. */
.session-info-modal :deep(.n-card__content) {
  overflow: hidden;
}

.card {
  border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--bg-elevated, transparent);
}

.card-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 650;
  color: var(--fg, #1f2328);
  margin-bottom: 10px;
}

.card-title > :first-child {
  color: var(--accent, #2563eb);
}

.count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted, #71717a);
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
  border-radius: 999px;
  padding: 1px 8px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  max-width: 220px;
}

.empty {
  font-size: 12px;
}

.ext-list,
.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.ext-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 8px;
  border-radius: 8px;
  transition: background 120ms ease;
}

.ext-row:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.07));
}

.ext-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.ext-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg, #1f2328);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-brief {
  font-size: 11.5px;
  color: var(--fg-muted, #71717a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ext-path {
  font-size: 10.5px;
  color: var(--fg-faint, #999);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.file-row:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.07));
}

.file-row:hover .file-icon {
  color: var(--accent, #2563eb);
}

.file-icon {
  flex-shrink: 0;
  color: var(--fg-muted, #71717a);
  transition: color 120ms ease;
}

.file-path {
  font-size: 11.5px;
  color: var(--fg-muted, #71717a);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer {
  display: flex;
  justify-content: flex-end;
}

:root.dark .card-title {
  color: #e6edf3;
}

:root.dark .ext-name {
  color: #e6edf3;
}
</style>
