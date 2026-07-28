<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  NButton,
  NInput,
  NModal,
  NScrollbar,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NText,
  NTag,
  useMessage,
} from "naive-ui";
import type { ModelsProviderAuth } from "../../../shared/models-settings";
import ProviderIcon from "@renderer/components/ProviderIcon.vue";
import CustomModelsPanel from "@renderer/components/CustomModelsPanel.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const message = useMessage();
const modelsText = ref("");
const apiKeys = ref<Record<string, string>>({});
const providers = ref<ModelsProviderAuth[]>([]);
const available = ref<{ provider: string; id: string; name: string }[]>([]);
const loading = ref(false);
const saving = ref(false);
const selectedProvider = ref<string | null>(null);
const mainTab = ref<"auth" | "custom" | "json">("auth");
const pickerOpen = ref(false);
const pickerQuery = ref("");
const customStartAdd = ref(false);

const configuredProviders = computed(() => providers.value.filter((p) => p.configured));

const leftList = computed(() => {
  const list = [...configuredProviders.value];
  if (
    selectedProvider.value &&
    !list.some((p) => p.id === selectedProvider.value)
  ) {
    const pending = providers.value.find((p) => p.id === selectedProvider.value);
    if (pending) list.push(pending);
  }
  return list;
});

const availableToAdd = computed(() => {
  const q = pickerQuery.value.trim().toLowerCase();
  return providers.value.filter((p) => {
    if (p.configured) return false;
    if (!q) return true;
    return (
      p.displayName.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
    );
  });
});

const selectedMeta = computed(() =>
  providers.value.find((p) => p.id === selectedProvider.value) ?? null,
);

const selectedModels = computed(() => {
  if (!selectedProvider.value) return [];
  return available.value.filter((m) => m.provider === selectedProvider.value);
});

function sourceLabel(source?: string): string {
  switch (source) {
    case "stored":
      return "auth.json";
    case "environment":
      return t.modelsSourceEnv;
    case "runtime":
      return t.modelsSourceRuntime;
    case "fallback":
      return t.modelsSourceFallback;
    case "models_json_command":
      return t.modelsSourceCommand;
    default:
      return source || t.modelsSourceUnknown;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await window.api.models.get();
    modelsText.value = data.modelsText;
    providers.value = data.providers ?? [];
    available.value = data.available;
    apiKeys.value = {};
    const configured = providers.value.filter((p) => p.configured);
    if (
      !selectedProvider.value ||
      !providers.value.some((p) => p.id === selectedProvider.value)
    ) {
      selectedProvider.value = configured[0]?.id ?? providers.value[0]?.id ?? null;
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      pickerOpen.value = false;
      void load();
    }
  },
);

onMounted(() => {
  if (props.open) void load();
});

function openPicker(): void {
  pickerQuery.value = "";
  pickerOpen.value = true;
}

function selectProvider(id: string): void {
  selectedProvider.value = id;
  pickerOpen.value = false;
  pickerQuery.value = "";
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const keysToWrite = Object.fromEntries(
      Object.entries(apiKeys.value).filter(([, v]) => Boolean(v?.trim())),
    );
    await window.api.models.set({
      modelsText: modelsText.value,
      apiKeys: keysToWrite,
    });
    message.success(t.saved);
    emit("saved");
    window.dispatchEvent(new CustomEvent("pi-models-changed"));
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}

async function clearKey(): Promise<void> {
  if (!selectedProvider.value) return;
  try {
    await window.api.models.clearKey(selectedProvider.value);
    delete apiKeys.value[selectedProvider.value];
    message.success(t.modelsKeyCleared);
    await load();
    window.dispatchEvent(new CustomEvent("pi-models-changed"));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function goCustomPanel(): void {
  pickerOpen.value = false;
  mainTab.value = "custom";
  customStartAdd.value = true;
}
</script>

<template>
  <NModal
    :show="open"
    preset="card"
    :title="t.modelsTitle"
    class="models-modal pi-settings-modal"
    style="width: min(880px, 94vw)"
    :bordered="false"
    :mask-closable="!pickerOpen"
    role="dialog"
    aria-modal="true"
    @update:show="(v) => !v && emit('close')"
  >
    <template #header-extra>
      <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
        ~/.pi/agent
      </NText>
    </template>

    <div class="modal-body">
      <NSpin :show="loading" class="spin-fill">
        <NTabs v-model:value="mainTab" type="line" size="small" animated>
          <NTabPane name="auth" tab="Providers">
            <div class="layout">
              <div class="left">
                <div class="left-head">
                  <NText class="section-label">{{ t.modelsConfigured }}</NText>
                  <NButton size="tiny" type="primary" secondary @click="openPicker">
                    {{ t.modelsAdd }}
                  </NButton>
                </div>
                <NScrollbar class="left-scroll">
                  <button
                    v-for="p in leftList"
                    :key="p.id"
                    type="button"
                    class="provider-row"
                    :class="{ active: selectedProvider === p.id }"
                    @click="selectProvider(p.id)"
                  >
                    <ProviderIcon :provider="p.id" :size="20" />
                    <div class="meta">
                      <div class="name">{{ p.displayName }}</div>
                      <NText depth="3" style="font-size: 11px">
                        {{ p.configured ? t.modelsConfigured : t.modelsPending }}
                        <template v-if="p.configured"> · {{ t.modelsAvailableCount(p.modelCount) }}</template>
                      </NText>
                    </div>
                  </button>
                  <div v-if="!leftList.length" class="empty-left">
                    {{ t.modelsEmptyProviders }}
                  </div>
                </NScrollbar>
              </div>

              <div class="right">
                <NScrollbar class="right-scroll">
                  <template v-if="selectedMeta">
                    <div class="detail-head">
                      <ProviderIcon :provider="selectedMeta.id" :size="26" />
                      <div style="min-width: 0; flex: 1">
                        <div class="detail-title">{{ selectedMeta.displayName }}</div>
                        <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
                          {{ selectedMeta.id }}
                        </NText>
                      </div>
                      <NTag
                        size="small"
                        :type="selectedMeta.configured ? 'success' : 'warning'"
                        :bordered="false"
                      >
                        {{ selectedMeta.configured ? t.modelsConfigured : t.modelsNotConfigured }}
                      </NTag>
                    </div>

                    <div class="field">
                      <div class="field-label">
                        <NText style="font-size: 12px; font-weight: 600">API Key</NText>
                        <NButton
                          v-if="selectedMeta.configured && selectedMeta.source === 'stored'"
                          size="tiny"
                          quaternary
                          type="error"
                          @click="clearKey"
                        >
                          {{ t.modelsClearKey }}
                        </NButton>
                      </div>
                      <NInput
                        v-model:value="apiKeys[selectedMeta.id]"
                        type="password"
                        size="small"
                        show-password-on="click"
                        :placeholder="
                          selectedMeta.configured
                            ? selectedMeta.source === 'environment'
                              ? t.modelsKeyFromEnv
                              : t.modelsKeyKeep
                            : t.modelsKeyPaste
                        "
                      />
                      <NText depth="3" style="font-size: 11px">
                        {{ t.modelsKeyHint }}
                      </NText>
                    </div>

                    <div class="models-block">
                      <NText style="font-size: 12px; font-weight: 600">
                        {{ t.modelsAvailable(selectedModels.length) }}
                      </NText>
                      <div v-if="!selectedModels.length" class="empty-models">
                        {{ t.modelsNone }}
                      </div>
                      <div
                        v-for="m in selectedModels"
                        :key="`${m.provider}/${m.id}`"
                        class="model-row"
                      >
                        <span class="model-name">{{ m.name }}</span>
                        <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
                          {{ m.id }}
                        </NText>
                      </div>
                    </div>
                  </template>
                  <div v-else class="empty-right">
                    <NText depth="3">{{ t.modelsSelectHint }}</NText>
                  </div>
                </NScrollbar>
              </div>
            </div>
          </NTabPane>

          <NTabPane name="custom" :tab="t.modelsCustomTab">
            <CustomModelsPanel
              v-model:models-text="modelsText"
              v-model:start-add="customStartAdd"
            />
          </NTabPane>

          <NTabPane name="json" tab="models.json">
            <div class="json-pane">
              <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
                {{ t.modelsJsonHint }}
              </NText>
              <NInput
                v-model:value="modelsText"
                type="textarea"
                class="json-editor"
                :autosize="false"
                placeholder="{}"
                style="font-family: var(--font-mono); font-size: 12px"
              />
            </div>
          </NTabPane>
        </NTabs>
      </NSpin>

      <!-- Inline picker overlay (avoid nested NModal which often fails to show) -->
      <div v-if="pickerOpen" class="picker-overlay" @click.self="pickerOpen = false">
        <div class="picker-panel" role="dialog" :aria-label="t.modelsAddProvider">
          <div class="picker-head">
            <NText strong style="font-size: 13px">{{ t.modelsAddProvider }}</NText>
            <NButton size="tiny" quaternary @click="pickerOpen = false">{{ t.close }}</NButton>
          </div>
          <NInput
            v-model:value="pickerQuery"
            size="small"
            :placeholder="t.modelsSearchProvider"
            clearable
            autofocus
            style="margin-bottom: 8px"
          />
          <NScrollbar style="max-height: 320px">
            <button type="button" class="picker-card" @click="goCustomPanel">
              <div class="picker-meta">
                <div class="name">{{ t.modelsCustomProvider }}</div>
                <NText depth="3" style="font-size: 11px">{{ t.modelsCustomHint }}</NText>
              </div>
            </button>
            <button
              v-for="p in availableToAdd"
              :key="p.id"
              type="button"
              class="picker-card"
              @click="selectProvider(p.id)"
            >
              <ProviderIcon :provider="p.id" :size="22" />
              <div class="picker-meta">
                <div class="name">{{ p.displayName }}</div>
                <NText depth="3" style="font-size: 11px">
                  {{ p.id }} · {{ t.modelsNeedsKey }}
                </NText>
              </div>
              <NText depth="3" style="font-size: 11px">API Key</NText>
            </button>
            <div v-if="!availableToAdd.length" class="empty-models">
              {{ t.modelsNothingToAdd }}
            </div>
          </NScrollbar>
        </div>
      </div>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" @click="emit('close')">{{ t.close }}</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="save">{{ t.save }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.modal-body {
  position: relative;
  height: min(560px, 70vh);
  overflow: hidden;
}

.spin-fill {
  height: 100%;
}

.spin-fill :deep(.n-spin-content) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.spin-fill :deep(.n-tabs) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.spin-fill :deep(.n-tabs-pane-wrapper),
.spin-fill :deep(.n-tab-pane) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 0;
  flex: 1;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.left {
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.left-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  flex-shrink: 0;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--fg-faint);
}

.left-scroll {
  flex: 1;
  min-height: 0;
}

.provider-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.provider-row:hover {
  background: var(--bg-hover);
}

.provider-row.active {
  background: var(--bg-selected);
}

.meta {
  min-width: 0;
}

.name {
  font-size: 12.5px;
  font-weight: 550;
  color: var(--fg-strong);
}

.right {
  min-width: 0;
  min-height: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

.right-scroll {
  flex: 1;
  min-height: 0;
  padding: 20px 24px 24px;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.detail-title {
  font-size: 14px;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.models-block {
  margin-top: 4px;
}

.model-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 2px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}

.model-name {
  font-weight: 500;
}

.empty-models,
.empty-left,
.empty-right {
  padding: 14px 10px;
  color: var(--fg-faint);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-line;
}

.empty-right {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.json-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.json-editor {
  flex: 1;
  min-height: 0;
}

.json-editor :deep(textarea) {
  height: 100% !important;
  min-height: 360px;
}

.picker-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(0, 0, 0, 0.28);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.picker-panel {
  width: min(440px, 100%);
  max-height: 90%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.picker-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  cursor: pointer;
  text-align: left;
}

.picker-card:hover {
  border-color: var(--accent, #2563eb);
  background: var(--bg-hover);
}

.picker-meta {
  flex: 1;
  min-width: 0;
}
</style>
