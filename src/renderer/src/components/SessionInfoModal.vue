<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NModal, NScrollbar, NSpin, NTag, NText } from "naive-ui";
import { useChatStore } from "@renderer/stores/chat";
import { parseToolCard } from "@renderer/utils/tool-diff";
import type { WorkerResourceSummary } from "../../../shared/worker-resources";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean; sessionId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const chat = useChatStore();
const resources = ref<WorkerResourceSummary | null>(null);
const loading = ref(false);

/** Files the agent read in this session (from tool messages). */
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

watch(
  () => props.open,
  async (open) => {
    if (!open || !props.sessionId) return;
    loading.value = true;
    resources.value = null;
    try {
      const info = await window.api.sessions.getInfo(props.sessionId);
      resources.value = info.resources ?? null;
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
    style="width: min(660px, 94vw)"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 12px">
      {{ t.sessionInfoHint }}
    </NText>
    <NSpin :show="loading" class="spin-fill">
      <NScrollbar class="info-scroll">
        <div class="section">
          <div class="section-title">
            {{ t.sessionInfoTools }}
            <span class="count">{{ resources?.activeTools.length ?? 0 }}</span>
          </div>
          <div v-if="resources?.activeTools.length" class="chips">
            <NTag v-for="tool in resources.activeTools" :key="tool" size="small" :bordered="false">
              {{ tool }}
            </NTag>
          </div>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </div>

        <div class="section">
          <div class="section-title">
            {{ t.sessionInfoExtensions }}
            <span class="count">{{ resources?.extensionPaths.length ?? 0 }}</span>
          </div>
          <ul v-if="resources?.extensionPaths.length" class="list">
            <li v-for="ext in resources.extensionPaths" :key="ext" class="item mono" :title="ext">
              {{ ext }}
            </li>
          </ul>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </div>

        <div class="section">
          <div class="section-title">
            {{ t.sessionInfoSkills }}
            <span class="count">{{ resources?.skillNames.length ?? 0 }}</span>
          </div>
          <div v-if="resources?.skillNames.length" class="chips">
            <NTag v-for="s in resources.skillNames" :key="s" size="small" :bordered="false">
              {{ s }}
            </NTag>
          </div>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </div>

        <div class="section">
          <div class="section-title">
            {{ t.sessionInfoFilesRead }}
            <span class="count">{{ filesRead.length }}</span>
          </div>
          <ul v-if="filesRead.length" class="list">
            <li v-for="p in filesRead" :key="p" class="item mono" :title="p">{{ p }}</li>
          </ul>
          <NText v-else depth="3" class="empty">{{ t.sessionInfoEmpty }}</NText>
        </div>
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
.spin-fill {
  height: 100%;
}
.info-scroll {
  max-height: min(56vh, 460px);
  padding-right: 6px;
}
.section {
  margin-bottom: 16px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
  color: var(--fg, #1f2328);
  margin-bottom: 8px;
}
.count {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted, #71717a);
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
  border-radius: 999px;
  padding: 1px 7px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.empty {
  font-size: 12px;
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.item {
  font-size: 11.5px;
  color: var(--fg-muted, #71717a);
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item.mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.footer {
  display: flex;
  justify-content: flex-end;
}
:root.dark .section-title {
  color: #e6edf3;
}
</style>
