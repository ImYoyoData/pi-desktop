<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from "vue";
import { NButton, NEmpty, NIcon, NTag, NText, useMessage } from "naive-ui";
import { AddOutline, InformationCircleOutline, SparklesOutline } from "@vicons/ionicons5";
import AskUserStrip from "@renderer/components/AskUserStrip.vue";
import SessionInfoModal from "@renderer/components/SessionInfoModal.vue";
import PermissionStrip from "@renderer/components/PermissionStrip.vue";
import ExtensionUiStrip from "@renderer/components/ExtensionUiStrip.vue";
import SessionTodoPanel from "@renderer/components/SessionTodoPanel.vue";
import SessionChangedFiles from "@renderer/components/SessionChangedFiles.vue";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { hasAnyFileChange } from "@renderer/utils/session-file-changes";

/**
 * Heaviest chat chrome — load lazily so first paint / session switch stays
 * responsive on slower CPUs (markdown + monaco parsing happens off the
 * critical path).
 */
const Composer = defineAsyncComponent(
  () => import("@renderer/components/Composer.vue"),
);
const MessageList = defineAsyncComponent(
  () => import("@renderer/components/MessageList.vue"),
);
import {
  formatElapsedShort,
} from "@renderer/utils/agent-wait";
import { t } from "@renderer/i18n";

const chat = useChatStore();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const widgets = useSessionWidgetsStore();

widgets.restoreTodoSnapshots();
const message = useMessage();

/** 面板被折叠/让位给编辑器区域时不参与可见性：消息区据此暂停测量与贴底。 */
const props = defineProps<{ visible?: boolean }>();

/** Any docked widget (todo / changed files) above the composer? */
const hasTodoDock = computed(() => Boolean(widgets.activeTodoList));
/**
 * hasAnyFileChange scans every tool row per call; streaming ticks invalidate
 * it constantly. Throttle to a ~120ms trailing recompute — the dock gate only
 * needs to track presence, not per-tick truth.
 */
const hasFileDock = ref(hasAnyFileChange(chat.activeMessages, chat.activeStreaming));
let dockScanTimer = 0;
watch(
  () => [chat.activeMessages, chat.activeStreaming] as const,
  () => {
    if (dockScanTimer) return;
    dockScanTimer = window.setTimeout(() => {
      dockScanTimer = 0;
      hasFileDock.value = hasAnyFileChange(chat.activeMessages, chat.activeStreaming);
    }, 120);
  },
);
const hasDock = computed(() => hasTodoDock.value || hasFileDock.value);

watch(
  () => chat.securityRemediationTick,
  (n, prev) => {
    if (n > (prev ?? 0)) {
      message.warning(t.securityToolDeniedToast, { duration: 5500 });
    }
  },
);
const isDraft = computed(() => !sessions.activeId && Boolean(sessions.draftRoot));
const hasSession = computed(() => Boolean(sessions.activeId) || isDraft.value);

const canCreateSession = computed(
  () => !workspace.root || workspace.sessionsReady,
);

const running = computed(() => {
  const id = sessions.activeId;
  if (!id) return false;
  const row = sessions.sessions.find((s) => s.id === id);
  return chat.activeRunning || row?.status === "running";
});

const nowTick = ref(Date.now());
const sessionInfoOpen = ref(false);
let headerTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  chat.bindEvents();
  headerTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (headerTimer) clearInterval(headerTimer);
  headerTimer = null;
  if (dockScanTimer) clearTimeout(dockScanTimer);
  dockScanTimer = 0;
});

const headerWaitLabel = computed(() => {
  void nowTick.value;
  const s = chat.activeWaitState;
  if (!s) return t.agentRunning;
  if (s.autoRecovering) return t.autoRecovering;
  // Header shows whole-turn total; per-phase clocks live in AgentWaitIndicator.
  const elapsed = s.turnStartedAt
    ? formatElapsedShort(Math.max(0, nowTick.value - s.turnStartedAt))
    : "";
  return elapsed ? `${t.agentRunning} · ${elapsed}` : t.agentRunning;
});

const showHeaderRunning = computed(
  () => running.value || Boolean(chat.activeWaitState?.autoRecovering),
);

const title = computed(() => {
  if (isDraft.value) return t.newSession;
  if (!sessions.activeId) return "";
  const row = sessions.sessions.find((s) => s.id === sessions.activeId);
  if (row?.name?.trim()) return row.name.trim();
  if (row?.firstMessage?.trim() && row.firstMessage !== "(no messages)") {
    const text = row.firstMessage.trim();
    return text.length > 56 ? `${text.slice(0, 53)}…` : text;
  }
  return t.newSession;
});

async function onNewAgent(): Promise<void> {
  if (!canCreateSession.value && workspace.root) return;
  let root = workspace.root;
  if (!root) root = await workspace.openWorkspace();
  if (!root) return;
  if (!workspace.sessionsReady) return;
  sessions.beginDraft(root);
}
</script>

<template>
  <section class="chat-panel">
    <template v-if="!hasSession">
      <div class="empty-agent">
        <NEmpty :description="t.selectOrCreateSession">
          <template #icon>
            <NIcon :component="SparklesOutline" :size="28" />
          </template>
          <template #extra>
            <NButton
              type="primary"
              :disabled="!canCreateSession"
              @click="onNewAgent"
            >
              <template #icon>
                <NIcon :component="AddOutline" />
              </template>
              {{ t.newAgent }}
            </NButton>
          </template>
        </NEmpty>
      </div>
    </template>

    <template v-else>
      <header class="head">
        <NText strong style="flex: 1; min-width: 0" class="title">{{ title }}</NText>
        <NTag v-if="chat.activeRetryHint" type="warning" size="small" round :bordered="false">
          {{
            t.retrying(
              chat.activeRetryHint.attempt,
              chat.activeRetryHint.maxAttempts,
            )
          }}
        </NTag>
        <NTag v-else-if="showHeaderRunning" type="success" size="small" round :bordered="false">
          {{ headerWaitLabel }}
        </NTag>
        <NButton
          quaternary
          circle
          size="tiny"
          class="pi-interactive"
          :disabled="!sessions.activeId"
          :title="t.sessionInfoTitle"
          :aria-label="t.sessionInfoTitle"
          @click="sessionInfoOpen = true"
        >
          <template #icon>
            <NIcon :component="InformationCircleOutline" :size="15" />
          </template>
        </NButton>
      </header>
      <MessageList
        :messages="chat.activeMessages"
        :streaming="chat.activeStreaming"
        :running="running"
        :retry-hint="chat.activeRetryHint"
        :history-loading="chat.historyLoading"
        :visible="props.visible !== false"
      />
      <!-- Permission blocks the tool; when both pending, show permission first. -->
      <PermissionStrip />
      <ExtensionUiStrip v-if="!chat.activePendingPermission" />
      <AskUserStrip
        v-if="!chat.activePendingPermission && !chat.activePendingExtensionUi"
      />
      <!-- Docked widgets share one surface with the composer (chat-input-stack). -->
      <div class="chat-input-stack">
        <div v-if="hasDock" class="stack-above">
          <SessionTodoPanel />
          <SessionChangedFiles />
        </div>
        <Composer :docked="hasDock" />
      </div>
    </template>
    <SessionInfoModal
      :open="sessionInfoOpen"
      :session-id="sessions.activeId"
      @close="sessionInfoOpen = false"
    />
  </section>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--bg);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 var(--chat-pad-x, 10px);
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-agent {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}

/* Chat input stack — docked todo / changed-files share the composer surface. */
.chat-input-stack {
  flex-shrink: 0;
  width: 100%;
  max-width: var(--composer-max, 748px);
  margin: 0 auto;
  padding: 0 var(--chat-pad-x, 12px) 10px;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stack-above {
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: var(--radius-lg, 8px) var(--radius-lg, 8px) 0 0;
  background: var(--tool-bg, #f5f6f7);
  padding: 3px 3px 0;
  overflow: hidden;
  box-shadow: none;
}

/* Inner vertical hairline between docked members. */
.stack-above :deep(.todo-dock) + :deep(.files-dock) {
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  margin-top: 4px;
  padding-top: 4px;
}
</style>
