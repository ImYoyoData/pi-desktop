<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useDialog } from "naive-ui";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useChatStore } from "@renderer/stores/chat";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const dialog = useDialog();
const sessions = useSessionsStore();
const chat = useChatStore();
const workspace = useWorkspaceStore();

let offCloseRequest: (() => void) | undefined;
let handling = false;

function runningSessionIds(): string[] {
  const ids = new Set<string>();
  for (const s of sessions.sessions) {
    if (s.status === "running") ids.add(s.id);
  }
  for (const id of Object.keys(chat.bySession)) {
    if (chat.bySession[id]?.running) ids.add(id);
  }
  return [...ids];
}

async function forceCloseAfterKill(ids: string[]): Promise<void> {
  const root = workspace.root;
  for (const id of ids) {
    try {
      await sessions.killWorker(id, root);
    } catch {
      // best-effort kill before force close
    }
  }
  await window.api.window.forceClose();
}

async function handleCloseRequest(): Promise<void> {
  if (handling) return;
  handling = true;
  try {
    const running = runningSessionIds();
    if (!running.length) {
      try {
        await window.api.window.forceClose();
      } finally {
        handling = false;
      }
      return;
    }
    dialog.warning({
      title: t.closeRunningTitle,
      content: t.closeRunningContent(running.length),
      positiveText: t.forceCloseApp,
      negativeText: t.cancel,
      onPositiveClick: async () => {
        try {
          await forceCloseAfterKill(running);
        } finally {
          handling = false;
        }
      },
      onNegativeClick: () => {
        handling = false;
      },
      onClose: () => {
        handling = false;
      },
    });
  } catch {
    handling = false;
  }
}

onMounted(() => {
  offCloseRequest = window.api.window.onCloseRequest(() => {
    void handleCloseRequest();
  });
});

onUnmounted(() => {
  offCloseRequest?.();
});
</script>

<template>
  <span class="close-guard" aria-hidden="true" />
</template>

<style scoped>
.close-guard {
  display: none;
}
</style>
