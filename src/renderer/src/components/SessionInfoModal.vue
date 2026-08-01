<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NModal,
  NSpin,
  NText,
} from "naive-ui";
import { ChevronDownOutline, ChevronForwardOutline, DocumentOutline, ExtensionPuzzleOutline, FileTrayFullOutline, SparklesOutline, TerminalOutline } from "@vicons/ionicons5";
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

/** Collapse state per section (default: all open). */
const collapsed = ref<Record<string, boolean>>({});
function toggleSection(key: string): void {
  collapsed.value = { ...collapsed.value, [key]: !collapsed.value[key] };
}
function isCollapsed(key: string): boolean {
  return Boolean(collapsed.value[key]);
}

/** Files the agent read in this session (from read tool calls). */
const filesRead = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const msg of chat.activeMessages) {
    if (msg.role !== "tool") continue;
    try {
      const card = parseToolCard(msg.toolName, msg.args, msg.result, {
        isError: msg.isError,
      });
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

async function load(): Promise<void> {
  if (!props.sessionId) return;
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
}

watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);

watch(
  () => props.sessionId,
  (id) => {
    if (props.open && id) void load();
  },
);

// Auto-refresh while open: when the session worker finishes loading its
// extensions/skills/tools, update the panel without requiring a re-click.
let offWorkerReady: (() => void) | undefined;

onMounted(() => {
  offWorkerReady = window.api.sessions.onWorkerReady((sessionId) => {
    if (props.open && props.sessionId === sessionId) void load();
  });
});

onUnmounted(() => {
  offWorkerReady?.();
});
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
      <div class="modal-scroll info-scroll">
        <!-- Tools -->
        <section class="card">
          <button
            type="button"
            class="card-title sect-toggle"
            :aria-expanded="!isCollapsed('tools')"
            @click="toggleSection('tools')"
          >
            <NIcon :component="TerminalOutline" :size="15" />
            <span>{{ t.sessionInfoTools }}</span>
            <span class="count">{{ resources?.activeTools.length ?? 0 }}</span>
            <NIcon
              class="chev"
              :component="isCollapsed('tools') ? ChevronForwardOutline : ChevronDownOutline"
              :size="13"
            />
          </button>
          <div v-if="!isCollapsed('tools')" class="sect-body">
            <div v-if="resources?.activeTools.length" class="card-grid">
              <div v-for="tool in resources.activeTools" :key="tool.name" class="item-card">
                <div class="item-name" :title="tool.name">{{ tool.name }}</div>
                <div v-if="tool.brief" class="item-brief" :title="tool.brief">{{ tool.brief }}</div>
              </div>
            </div>
            <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
          </div>
        </section>

        <!-- Extensions -->
        <section class="card">
          <button
            type="button"
            class="card-title sect-toggle"
            :aria-expanded="!isCollapsed('ext')"
            @click="toggleSection('ext')"
          >
            <NIcon :component="ExtensionPuzzleOutline" :size="15" />
            <span>{{ t.sessionInfoExtensions }}</span>
            <span class="count">{{ extensions.length }}</span>
            <NIcon
              class="chev"
              :component="isCollapsed('ext') ? ChevronForwardOutline : ChevronDownOutline"
              :size="13"
            />
          </button>
          <div v-if="!isCollapsed('ext')" class="sect-body">
            <div v-if="extensions.length" class="card-grid">
              <div v-for="ext in extensions" :key="ext.path" class="item-card">
                <div class="item-name" :title="ext.name">{{ ext.name }}</div>
                <div v-if="ext.brief" class="item-brief" :title="ext.brief">{{ ext.brief }}</div>
                <div class="item-path" :title="ext.path">{{ ext.path }}</div>
              </div>
            </div>
            <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
          </div>
        </section>

        <!-- Skills -->
        <section class="card">
          <button
            type="button"
            class="card-title sect-toggle"
            :aria-expanded="!isCollapsed('skills')"
            @click="toggleSection('skills')"
          >
            <NIcon :component="SparklesOutline" :size="15" />
            <span>{{ t.sessionInfoSkills }}</span>
            <span class="count">{{ resources?.skillNames.length ?? 0 }}</span>
            <NIcon
              class="chev"
              :component="isCollapsed('skills') ? ChevronForwardOutline : ChevronDownOutline"
              :size="13"
            />
          </button>
          <div v-if="!isCollapsed('skills')" class="sect-body">
            <div v-if="resources?.skillNames.length" class="card-grid">
              <div v-for="sk in resources.skillNames" :key="sk.name" class="item-card">
                <div class="item-name" :title="sk.name">{{ sk.name }}</div>
                <div v-if="sk.brief" class="item-brief" :title="sk.brief">{{ sk.brief }}</div>
              </div>
            </div>
            <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
          </div>
        </section>

        <!-- Files read -->
        <section class="card">
          <button
            type="button"
            class="card-title sect-toggle"
            :aria-expanded="!isCollapsed('files')"
            @click="toggleSection('files')"
          >
            <NIcon :component="FileTrayFullOutline" :size="15" />
            <span>{{ t.sessionInfoFilesRead }}</span>
            <span class="count">{{ filesRead.length }}</span>
            <NIcon
              class="chev"
              :component="isCollapsed('files') ? ChevronForwardOutline : ChevronDownOutline"
              :size="13"
            />
          </button>
          <div v-if="!isCollapsed('files')" class="sect-body">
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
          </div>
        </section>
      </div>
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
  padding-right: 6px;
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
  width: 100%;
  margin: 0 0 4px;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 650;
  color: var(--fg, #1f2328);
  text-align: left;
  cursor: pointer;
}

.card-title > :first-child {
  color: var(--accent, #2563eb);
}

.sect-toggle:hover .chev {
  color: var(--accent, #2563eb);
}

.chev {
  color: var(--fg-muted, #71717a);
  transition: color 120ms ease;
}

/* Each section body scrolls internally when content overflows. */
.sect-body {
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
  margin-top: 6px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.item-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.2));
  border-radius: 9px;
  background: var(--bg-hover, rgba(127, 127, 127, 0.05));
  min-width: 0;
}

.item-name {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--fg, #1f2328);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-brief {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--fg-muted, #71717a);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.item-path {
  font-size: 10px;
  color: var(--fg-faint, #999);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.empty {
  font-size: 12px;
}

.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
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

:root.dark .item-name {
  color: #e6edf3;
}
</style>
