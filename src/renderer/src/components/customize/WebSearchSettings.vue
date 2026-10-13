<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { NAlert, NText, NSelect, useMessage } from "naive-ui";
import type { WebSearchSettings } from "../../../../shared/web-search-config";
import type { ModelsProviderAuth } from "../../../../shared/models-settings";
import { useSessionsStore } from "@renderer/stores/sessions";
import { t } from "@renderer/i18n";

const message = useMessage();
const sessions = useSessionsStore();

/** 浅层响应式：settings 每次整体替换，从不就地改；ref 的深层代理无法结构化克隆过 IPC。 */
const settings = shallowRef<WebSearchSettings>({ providerSource: "" });

/** 联网搜索由 pi-web-access 扩展提供，未安装时下方设置无处可用。 */
const extensionInstalled = ref(true);

/** 已登录、有网关地址且走 Responses 协议的 Pi provider，才有资格托管搜索服务。 */
const providers = ref<ModelsProviderAuth[]>([]);

/** 复用方案的下拉项：Pi provider。 */
const piProviderOptions = computed(() =>
  providers.value.map((item) => ({ label: item.displayName || item.id, value: item.id })),
);

const selectedProvider = computed(
  () => providers.value.find((item) => item.id === settings.value.providerSource) ?? null,
);

/** 扩展从 provider 的 baseUrl 推导搜索端点：补上 /responses。 */
const derivedEndpoint = computed(() => {
  const base = selectedProvider.value?.baseUrl?.trim().replace(/\/+$/, "");
  if (!base) return "";
  return base.endsWith("/responses") ? base : `${base}/responses`;
});

onMounted(async () => {
  try {
    const state = await window.api.webSearchConfig.get();
    settings.value = state.settings;
    extensionInstalled.value = state.extensionInstalled;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
  try {
    const data = await window.api.models.get();
    // 复用凭据要打 /responses 端点，只有走 OpenAI Responses 协议的 provider 才行。
    providers.value = data.providers.filter(
      (item) => item.configured && item.baseUrl && item.responsesApi,
    );
    if (!settings.value.providerSource) {
      const preset = presetProvider();
      if (preset) await save({ providerSource: preset });
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
});

/** 默认预填当前会话正在用的模型所属 provider。 */
function presetProvider(): string {
  const id = sessions.activeId;
  const key = id ? sessionModelKey(id) : "";
  const provider = key?.split("/")[0] ?? "";
  return providers.value.some((item) => item.id === provider) ? provider : "";
}

function sessionModelKey(sessionId: string): string {
  try {
    const raw = localStorage.getItem("pi-desktop:session-model-prefs");
    if (!raw) return "";
    const models = (JSON.parse(raw) as { models?: Record<string, string> }).models;
    return typeof models?.[sessionId] === "string" ? models[sessionId] : "";
  } catch {
    return "";
  }
}

async function save(next: WebSearchSettings): Promise<void> {
  settings.value = next;
  try {
    const state = await window.api.webSearchConfig.set(next);
    settings.value = state.settings;
    extensionInstalled.value = state.extensionInstalled;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function setProviderSource(providerSource: string): void {
  void save({ providerSource });
}
</script>

<template>
  <div class="web-search-settings">
    <NText depth="3" class="row-hint">{{
      extensionInstalled ? t.webSearchExtensionNote : t.webSearchExtensionMissing
    }}</NText>

    <NAlert v-if="!extensionInstalled" type="warning" :bordered="false" class="extension-alert">
      {{ t.webSearchExtensionMissing }}
    </NAlert>

    <NText v-if="providers.length === 0" depth="3" class="row-hint">
      {{ t.webSearchProviderSourceEmpty }}
    </NText>

    <template v-else>
      <div class="switch-row">
        <div class="switch-labels">
          <NText strong>{{ t.webSearchProviderSourceProvider }}</NText>
          <NText depth="3" class="row-hint">{{ t.webSearchProviderSourceProviderHint }}</NText>
        </div>
        <NSelect
          class="setting-select"
          size="small"
          :disabled="!extensionInstalled"
          :value="settings.providerSource || null"
          :options="piProviderOptions"
          :placeholder="t.webSearchProviderSourcePlaceholder"
          @update:value="setProviderSource"
        />
      </div>

      <div v-if="derivedEndpoint && extensionInstalled" class="endpoint-box">
        <NText depth="3" class="row-hint">{{ t.webSearchProviderSourceEndpoint }}</NText>
        <NText depth="1" class="endpoint-value">{{ derivedEndpoint }}</NText>
      </div>
    </template>
  </div>
</template>

<style scoped>
.web-search-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 20px;
  overflow-y: auto;
}

.row-hint {
  font-size: 12px;
  line-height: 16px;
}

.extension-alert {
  font-size: 12px;
}

.endpoint-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 4px;
  background: var(--bg-hover);
}

.endpoint-value {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.switch-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.setting-select {
  flex-shrink: 0;
  width: 200px;
}
</style>
