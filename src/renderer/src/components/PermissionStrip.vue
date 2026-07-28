<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NIcon, NText } from "naive-ui";
import { ShieldCheckmarkOutline } from "@vicons/ionicons5";
import type { PermissionDecision, SecurityCategory } from "../../../shared/desktop-security";
import { t } from "@renderer/i18n";
import { useChatStore } from "@renderer/stores/chat";

const chat = useChatStore();
const replying = ref(false);

const prompt = computed(() => chat.activePendingPermission);

function categoryLabel(category: SecurityCategory): string {
  switch (category) {
    case "bash":
      return t.permissionCategoryBash;
    case "write":
      return t.permissionCategoryWrite;
    default: {
      const _never: never = category;
      void _never;
      return category;
    }
  }
}

async function reply(decision: PermissionDecision): Promise<void> {
  const p = prompt.value;
  if (!p || replying.value) return;
  replying.value = true;
  try {
    await chat.replyPermission(p.sessionId, p.requestId, decision);
  } finally {
    replying.value = false;
  }
}
</script>

<template>
  <div v-if="prompt" class="permission-wrap">
    <div class="permission-card" role="dialog" :aria-label="t.permissionTitle">
      <header class="strip-head">
        <div class="head-badge" aria-hidden="true">
          <NIcon :component="ShieldCheckmarkOutline" :size="16" />
        </div>
        <div class="head-text">
          <div class="head-title">{{ t.permissionTitle }}</div>
          <div class="head-sub">
            {{ t.permissionToolLine(prompt.toolName, categoryLabel(prompt.category)) }}
          </div>
        </div>
      </header>

      <div v-if="prompt.summary" class="strip-body">
        <NText depth="3" class="summary">{{ prompt.summary }}</NText>
      </div>

      <footer class="strip-foot">
        <NButton
          round
          class="pi-interactive"
          :disabled="replying"
          @click="reply('deny')"
        >
          {{ t.permissionDeny }}
        </NButton>
        <NButton
          round
          class="pi-interactive"
          :disabled="replying"
          @click="reply('allow_session_category')"
        >
          {{ t.permissionAllowSession }}
        </NButton>
        <NButton
          v-if="prompt.category === 'bash' && prompt.summary.trim()"
          round
          class="pi-interactive"
          :disabled="replying"
          @click="reply('allow_whitelist')"
        >
          {{ t.permissionAllowWhitelist }}
        </NButton>
        <NButton
          v-if="prompt.category === 'bash'"
          round
          class="pi-interactive"
          :disabled="replying"
          @click="reply('allow_once_background')"
        >
          {{ t.permissionAllowBackground }}
        </NButton>
        <NButton
          type="primary"
          round
          class="pi-interactive confirm-btn"
          :disabled="replying"
          :loading="replying"
          @click="reply('allow_once')"
        >
          {{ t.permissionAllowOnce }}
        </NButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.permission-wrap {
  flex-shrink: 0;
  padding: 0 12px 10px;
  max-height: min(42vh, 420px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  animation: perm-rise 240ms var(--ease-out, ease);
}

@keyframes perm-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.permission-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: inherit;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--accent-border, var(--border)) 55%, var(--border));
  background:
    linear-gradient(
      165deg,
      color-mix(in srgb, var(--accent-soft, transparent) 70%, var(--bg-elevated)) 0%,
      var(--bg-elevated, #fff) 42%
    );
  box-shadow:
    var(--shadow-md),
    0 0 0 1px color-mix(in srgb, var(--accent) 6%, transparent);
  overflow: hidden;
}

.strip-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 10px;
  flex-shrink: 0;
}

.head-badge {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  flex-shrink: 0;
}

.head-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.head-title {
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--fg-strong);
}

.head-sub {
  font-size: 12px;
  color: var(--fg-muted);
}

.strip-body {
  overflow-y: auto;
  padding: 4px 16px 8px;
  flex: 1;
  min-height: 0;
}

.summary {
  display: block;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 6em;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 70%, var(--bg));
}

.strip-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px 14px;
  flex-shrink: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
}

.confirm-btn {
  min-width: 96px;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .permission-wrap {
    animation: none;
  }
}
</style>
