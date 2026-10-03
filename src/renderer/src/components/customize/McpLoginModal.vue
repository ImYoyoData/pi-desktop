<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NButton, NInput, NModal, useMessage } from "naive-ui";
import type {
  McpAuthEventPayload,
  McpAuthTarget,
} from "../../../../shared/customizations";
import { t } from "@renderer/i18n";

const message = useMessage();

const props = defineProps<{
  show: boolean;
  target: McpAuthTarget | null;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();

const running = ref(false);
const cancelled = ref(false);
const info = ref("");
const authUrl = ref("");
const errorText = ref("");
const promptId = ref<number | null>(null);
const promptValue = ref("");

let unsubscribe: (() => void) | null = null;

function reset(): void {
  info.value = "";
  authUrl.value = "";
  errorText.value = "";
  promptId.value = null;
  promptValue.value = "";
}

function handleEvent(payload: McpAuthEventPayload): void {
  const target = props.target;
  if (!target || !running.value) return;
  if (payload.name !== target.name || payload.scope !== target.scope) return;
  const event = payload.event;
  if (event.type === "info") {
    info.value = event.message;
  } else if (event.type === "auth_url") {
    authUrl.value = event.url;
  } else if (event.type === "prompt") {
    promptId.value = event.promptId;
    promptValue.value = "";
  }
}

async function start(): Promise<void> {
  const target = props.target;
  if (!target) return;
  if (running.value) return;
  running.value = true;
  cancelled.value = false;
  reset();
  try {
    await window.api.customizations.mcpLogin(target);
    message.success(t.customizeMcpSignInSuccess);
    emit("changed");
    emit("close");
  } catch (err) {
    if (!cancelled.value) {
      errorText.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    running.value = false;
  }
}

async function cancel(): Promise<void> {
  cancelled.value = true;
  await window.api.customizations.mcpLoginCancel().catch(() => {});
  emit("close");
}

async function submitPrompt(): Promise<void> {
  const target = props.target;
  const id = promptId.value;
  if (!target || id === null) return;
  const value = promptValue.value.trim();
  if (!value) return;
  promptId.value = null;
  await window.api.customizations.mcpAuthPrompt({
    name: target.name,
    scope: target.scope,
    promptId: id,
    value,
  });
}

async function copyUrl(): Promise<void> {
  if (!authUrl.value) return;
  try {
    await navigator.clipboard.writeText(authUrl.value);
    message.success(t.customizeMcpCopied);
  } catch {
    // 剪贴板不可用时地址仍可手动复制
  }
}

onMounted(() => {
  unsubscribe = window.api.customizations.onMcpAuthEvent((payload) => handleEvent(payload));
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
});

watch(
  () => props.show,
  (show) => {
    if (show) void start();
  },
);
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="pi-settings-modal mcp-login-modal"
    style="width: min(520px, 94vw)"
    :bordered="false"
    :mask-closable="false"
    @close="emit('close')"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <template #header>
      <div class="modal-title-block">
        <div class="modal-title">
          {{ target ? t.customizeMcpSignInTitle(target.name) : t.customizeMcpSignIn }}
        </div>
      </div>
    </template>

    <div class="mcp-login-body">
      <div v-if="info" class="login-info">{{ info }}</div>
      <div v-else-if="running" class="login-info">{{ t.customizeMcpSignInWaiting }}</div>

      <div v-if="authUrl" class="login-url-block">
        <div class="login-url">{{ authUrl }}</div>
        <NButton size="tiny" secondary @click="copyUrl">
          {{ t.customizeMcpCopyUrl }}
        </NButton>
      </div>

      <template v-if="promptId !== null">
        <div class="login-hint">{{ t.customizeMcpSignInBrowserHint }}</div>
        <div class="login-prompt">
          <NInput
            v-model:value="promptValue"
            size="small"
            :placeholder="t.customizeMcpRedirectPlaceholder"
            @keydown.enter="submitPrompt"
          />
          <NButton size="small" type="primary" :disabled="!promptValue.trim()" @click="submitPrompt">
            {{ t.customizeMcpSubmit }}
          </NButton>
        </div>
      </template>

      <div v-if="errorText" class="login-error">
        {{ t.customizeMcpSignInFailed(errorText) }}
      </div>
    </div>

    <template #footer>
      <div class="modal-footer">
        <NButton size="small" @click="cancel">{{ t.cancel }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.mcp-login-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-info {
  color: var(--fg-muted);
  font-size: 12.5px;
  word-break: break-all;
}

.login-url-block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.login-url {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-active);
  color: var(--fg);
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  word-break: break-all;
}

.login-hint {
  color: var(--fg-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.login-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
}

.login-error {
  color: var(--error);
  font-size: 12px;
  word-break: break-word;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
