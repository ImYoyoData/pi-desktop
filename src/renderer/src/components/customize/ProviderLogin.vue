<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { NButton, NInput, NModal, NSelect, useMessage } from "naive-ui";
import type {
  ModelsOAuthEventPayload,
  ModelsProviderAuth,
} from "../../../../shared/models-settings";
import { t } from "@renderer/i18n";

const message = useMessage();

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ changed: []; close: [] }>();

const providers = ref<ModelsProviderAuth[]>([]);

const running = ref<string | null>(null);
const runningName = ref("");
const runMessage = ref("");
const authUrl = ref("");
const deviceCode = ref<{ userCode: string; verificationUri: string } | null>(null);
const cancelled = ref(false);

type PromptEvent = Extract<ModelsOAuthEventPayload["event"], { type: "prompt" }>;
const prompt = ref<PromptEvent | null>(null);
const promptValue = ref("");

let unsubscribe: (() => void) | null = null;

const oauthProviders = computed(() => providers.value.filter((p) => p.oauth));
const modalVisible = computed(() => props.show || running.value !== null);

const promptSelectOptions = computed(() => {
  const current = prompt.value;
  if (!current || current.prompt.type !== "select") return [];
  return current.prompt.options.map((option) => ({
    label: option.description ? `${option.label} — ${option.description}` : option.label,
    value: option.id,
  }));
});

async function refresh(): Promise<void> {
  try {
    const data = await window.api.models.get();
    providers.value = data.providers;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function handleEvent(payload: ModelsOAuthEventPayload): void {
  if (payload.providerId !== running.value) return;
  const event = payload.event;
  if (event.type === "info" || event.type === "progress") {
    runMessage.value = event.message;
  } else if (event.type === "auth_url") {
    authUrl.value = event.url;
    void window.api.browser.openExternal(event.url);
  } else if (event.type === "device_code") {
    deviceCode.value = { userCode: event.userCode, verificationUri: event.verificationUri };
    void window.api.browser.openExternal(event.verificationUri);
  } else if (event.type === "prompt") {
    prompt.value = event;
    promptValue.value = "";
  }
}

onMounted(async () => {
  unsubscribe = window.api.models.onOauthEvent((payload) => handleEvent(payload));
  await refresh();
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
});

function resetRunState(): void {
  runMessage.value = "";
  authUrl.value = "";
  deviceCode.value = null;
  prompt.value = null;
}

async function signIn(provider: ModelsProviderAuth): Promise<void> {
  if (running.value) return;
  running.value = provider.id;
  runningName.value = provider.displayName;
  cancelled.value = false;
  resetRunState();
  try {
    await window.api.models.oauthLogin(provider.id);
    message.success(t.providerAuthSuccess);
    emit("changed");
    // 模型选择器（Composer）监听该事件，登录成功后其分组立即出现新供应商。
    window.dispatchEvent(new Event("pi-models-changed"));
    await refresh();
  } catch (err) {
    if (!cancelled.value) {
      const text = err instanceof Error ? err.message : String(err);
      message.error(`${t.providerAuthFailed}: ${text}`, { duration: 8000 });
    }
  } finally {
    running.value = null;
    resetRunState();
  }
}

async function cancelSignIn(): Promise<void> {
  if (!running.value) return;
  cancelled.value = true;
  await window.api.models.oauthCancel();
}

async function submitPrompt(): Promise<void> {
  const current = prompt.value;
  if (!current || !running.value) return;
  const value = promptValue.value.trim();
  if (!value) return;
  prompt.value = null;
  await window.api.models.oauthPrompt({
    providerId: running.value,
    promptId: current.promptId,
    value,
  });
}

async function skipPrompt(): Promise<void> {
  const current = prompt.value;
  if (!current || !running.value) return;
  prompt.value = null;
  await window.api.models.oauthPrompt({
    providerId: running.value,
    promptId: current.promptId,
    cancelled: true,
  });
}

async function signOut(provider: ModelsProviderAuth): Promise<void> {
  try {
    await window.api.models.oauthLogout(provider.id);
    message.success(t.providerAuthLoggedOut);
    emit("changed");
    window.dispatchEvent(new Event("pi-models-changed"));
    await refresh();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

async function copyUserCode(): Promise<void> {
  if (!deviceCode.value) return;
  try {
    await navigator.clipboard.writeText(deviceCode.value.userCode);
    message.success(t.providerAuthCopied);
  } catch {
    message.error(t.providerAuthCopyFailed);
  }
}
</script>

<template>
  <NModal
    :show="modalVisible"
    preset="card"
    class="pi-settings-modal provider-login-modal"
    style="width: min(460px, 92vw)"
    :bordered="false"
    :mask-closable="false"
    :closable="!running"
    :auto-focus="false"
    @update:show="
      (value: boolean) => {
        if (!value && !running) emit('close');
      }
    "
  >
    <template #header>
      <div class="modal-title-block">
        <div class="modal-title">
          {{ running ? t.providerAuthRunningTitle(runningName) : t.providerAuthTitle }}
        </div>
      </div>
    </template>

    <div class="provider-login-content">
      <template v-if="running">
        <p v-if="runMessage" class="provider-login-text">{{ runMessage }}</p>

        <p v-if="authUrl" class="provider-login-text">
          {{ t.providerAuthBrowserHint }}
        </p>
        <p v-if="authUrl" class="provider-login-link">
          <a :href="authUrl" target="_blank" rel="noreferrer">{{ t.providerAuthOpenLink }}</a>
        </p>

        <div v-if="deviceCode" class="provider-login-device">
          <span class="provider-login-device-label">{{ t.providerAuthDeviceCode }}</span>
          <code class="provider-login-device-code">{{ deviceCode.userCode }}</code>
          <NButton size="tiny" @click="copyUserCode">{{ t.providerAuthCopied }}</NButton>
        </div>
        <p v-if="deviceCode" class="provider-login-text muted">
          {{ t.providerAuthDeviceHint }}
        </p>

        <div v-if="prompt" class="provider-login-prompt">
          <p class="provider-login-text">{{ prompt.prompt.message }}</p>
          <NSelect
            v-if="prompt.prompt.type === 'select'"
            v-model:value="promptValue"
            size="small"
            :options="promptSelectOptions"
          />
          <NInput
            v-else
            v-model:value="promptValue"
            size="small"
            :type="prompt.prompt.type === 'secret' ? 'password' : 'text'"
            :placeholder="prompt.prompt.placeholder"
            show-password-on="click"
            @keydown.enter="submitPrompt"
          />
          <div class="provider-login-prompt-actions">
            <NButton size="tiny" type="primary" :disabled="!promptValue.trim()" @click="submitPrompt">
              {{ t.providerAuthPromptSubmit }}
            </NButton>
            <NButton size="tiny" @click="skipPrompt">{{ t.providerAuthPromptSkip }}</NButton>
          </div>
        </div>

        <div class="provider-login-footer">
          <NButton size="small" type="warning" secondary @click="cancelSignIn">
            {{ t.providerAuthCancel }}
          </NButton>
        </div>
      </template>

      <template v-else>
        <p v-if="!oauthProviders.length" class="provider-login-text muted">
          {{ t.providerAuthEmpty }}
        </p>

        <ul v-else class="provider-login-list">
          <li v-for="provider in oauthProviders" :key="provider.id" class="provider-login-row">
            <div class="provider-login-info">
              <span class="provider-login-name">{{ provider.displayName }}</span>
              <span
                class="provider-login-status"
                :class="{ configured: provider.configured }"
              >
                {{ provider.configured ? t.providerAuthSignedIn : t.providerAuthNotSignedIn }}
              </span>
            </div>
            <div class="provider-login-actions">
              <NButton size="tiny" type="primary" @click="signIn(provider)">
                {{ t.providerAuthSignIn }}
              </NButton>
              <NButton v-if="provider.configured" size="tiny" @click="signOut(provider)">
                {{ t.providerAuthSignOut }}
              </NButton>
            </div>
          </li>
        </ul>

        <div class="provider-login-footer">
          <NButton size="small" @click="emit('close')">{{ t.providerAuthClose }}</NButton>
        </div>
      </template>
    </div>
  </NModal>
</template>

<style scoped>
.provider-login-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(560px, calc(100vh - 160px));
  overflow-y: auto;
}

.modal-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--fg-strong);
}

.modal-subtitle {
  font-size: 12px;
  color: var(--fg-muted);
}

.provider-login-text {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--fg);
  word-break: break-word;
}

.provider-login-text.muted {
  color: var(--fg-muted, var(--fg));
  opacity: 0.8;
}

.provider-login-link {
  margin: 0;
  font-size: 12px;
}

.provider-login-link a {
  color: var(--primary, #4493f8);
  word-break: break-all;
}

.provider-login-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.provider-login-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.provider-login-row:last-child {
  border-bottom: none;
}

.provider-login-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.provider-login-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
}

.provider-login-status {
  font-size: 11px;
  color: var(--fg-muted, var(--fg));
  opacity: 0.7;
}

.provider-login-status.configured {
  color: var(--success, #2ea043);
  opacity: 1;
}

.provider-login-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.provider-login-device {
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-login-device-label {
  font-size: 12px;
  color: var(--fg-muted, var(--fg));
}

.provider-login-device-code {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--fg);
}

.provider-login-prompt {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.provider-login-prompt-actions {
  display: flex;
  gap: 6px;
}

.provider-login-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
