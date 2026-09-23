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

/**
 * Drop a "新会话" the user never sent anything in — both the pre-warmed draft
 * (click 新建会话 then quit, where no session was ever active) and a session that
 * exists but has no messages. Without the draft half, an empty jsonl was left on
 * disk even though the sidebar never showed it.
 */
async function discardUnstarted(): Promise<void> {
  try {
    await sessions.discardUnstartedOnQuit();
  } catch {
    // best-effort cleanup before force close
  }
}

async function handleCloseRequest(): Promise<void> {
  if (handling) return;
  handling = true;
  try {
    const running = runningSessionIds();
    if (!running.length) {
      try {
        // Close may kill the renderer right after this call, so clean the
        // abandoned "新会话" before asking the window to close.
        await discardUnstarted();
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
          // Killing the worker leaves the session usable, so an unstarted one can
          // still be dropped here.
          await discardUnstarted();
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
