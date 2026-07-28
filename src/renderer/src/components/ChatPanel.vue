<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { NButton, NEmpty, NIcon, NTag, NText, useMessage } from "naive-ui";
import { AddOutline, SparklesOutline } from "@vicons/ionicons5";
import AskUserStrip from "@renderer/components/AskUserStrip.vue";
import PermissionStrip from "@renderer/components/PermissionStrip.vue";
import ExtensionUiStrip from "@renderer/components/ExtensionUiStrip.vue";
import Composer from "@renderer/components/Composer.vue";
import MessageList from "@renderer/components/MessageList.vue";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const chat = useChatStore();
const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const message = useMessage();

onMounted(() => {
  chat.bindEvents();
});

watch(
  () => chat.securityRemediationTick,
  (n, prev) => {
    if (n > (prev ?? 0)) {
      message.warning(t.securityToolDeniedToast, { duration: 5500 });
    }
  },
);
const hasSession = computed(() => Boolean(sessions.activeId));

const canCreateSession = computed(
  () => !workspace.trustDialogOpen && (!workspace.root || workspace.sessionsReady),
);

const running = computed(() => {
  const id = sessions.activeId;
  if (!id) return false;
  const row = sessions.sessions.find((s) => s.id === id);
  return chat.activeRunning || row?.status === "running";
});

const title = computed(() => {
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
  if (workspace.trustDialogOpen) return;
  let root = workspace.root;
  if (!root) root = await workspace.openWorkspace();
  if (!root) return;
  if (workspace.trustDialogOpen || !workspace.sessionsReady) return;
  const created = await sessions.createSession(root);
  if (created) {
    chat.hydrateFromHistory(created.id, []);
  }
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
        <NTag v-else-if="running" type="success" size="small" round :bordered="false">
          {{ t.agentRunning }}
        </NTag>
      </header>
      <MessageList
        :messages="chat.activeMessages"
        :streaming="chat.activeStreaming"
        :running="running"
        :retry-hint="chat.activeRetryHint"
        :history-loading="chat.historyLoading"
      />
      <!-- Permission blocks the tool; when both pending, show permission first. -->
      <PermissionStrip />
      <ExtensionUiStrip v-if="!chat.activePendingPermission" />
      <AskUserStrip
        v-if="!chat.activePendingPermission && !chat.activePendingExtensionUi"
      />
      <Composer />
    </template>
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
</style>
