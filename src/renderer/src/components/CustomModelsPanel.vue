<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSwitch,
  NText,
  NScrollbar,
  useDialog,
  useMessage,
} from "naive-ui";
import {
  CUSTOM_MODEL_APIS,
  emptyCustomProvider,
  listEditableProviders,
  mergeDiscoveredIntoDraft,
  parseModelsConfigText,
  removeCustomProvider,
  renameCustomProvider,
  shouldStoreApiKeyInModelsJson,
  stringifyModelsConfig,
  upsertCustomProvider,
  validateCustomProvider,
  type CustomModelEntry,
  type CustomProviderDraft,
} from "../../../shared/custom-models";
import { CUSTOM_PROVIDER_PRESETS } from "../../../shared/custom-model-presets";
import {
  normalizeProviderBaseUrl,
  type DiscoveredModel,
} from "../../../shared/model-discover";
import { t } from "@renderer/i18n";

const props = defineProps<{
  modelsText: string;
  /** When true, start a blank “add provider” form. */
  startAdd?: boolean;
  /** Parent is writing models.json / auth.json */
  saving?: boolean;
}>();

const emit = defineEmits<{
  "update:modelsText": [string];
  "update:startAdd": [boolean];
  /** Persist immediately (Pi-aligned: models.json + auth.json). */
  commit: [
    payload: {
      modelsText: string;
      apiKeys?: Record<string, string>;
      clearProviderKeys?: string[];
      successMessage?: string;
    },
  ];
}>();

const message = useMessage();
const dialog = useDialog();

const selectedId = ref<string | null>(null);
const editing = ref(false);
const isNew = ref(false);
const draft = ref<CustomProviderDraft>(emptyCustomProvider());
const formError = ref<string | null>(null);
const fetching = ref(false);
const testing = ref(false);

/** 拉起模型列表:discover 结果进入可勾选弹层,确认后才合并进草稿。 */
const pickOpen = ref(false);
const pickQuery = ref("");
const discovered = ref<DiscoveredModel[]>([]);
const pickedIds = ref(new Set<string>());

const filteredDiscovered = computed(() => {
  const q = pickQuery.value.trim().toLowerCase();
  if (!q) return discovered.value;
  return discovered.value.filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      (m.name ?? "").toLowerCase().includes(q),
  );
});

function togglePick(id: string): void {
  const next = new Set(pickedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  pickedIds.value = next;
}

function pickAll(): void {
  pickedIds.value = new Set(discovered.value.map((m) => m.id));
}

function pickNone(): void {
  pickedIds.value = new Set<string>();
}

function confirmPick(): void {
  const picked = discovered.value.filter((m) => pickedIds.value.has(m.id));
  if (!picked.length) {
    pickOpen.value = false;
    return;
  }
  draft.value.models = mergeDiscoveredIntoDraft(draft.value.models, picked);
  resetModelRowKeys(draft.value.models.length);
  pickOpen.value = false;
  message.success(t.modelsCustomFetchOk(picked.length));
}
/** Stable keys so deleting a model row updates the UI immediately (not index-based). */
const modelRowKeys = ref<string[]>([]);
let rowKeySeq = 0;

const apiOptions = CUSTOM_MODEL_APIS.map((api) => ({ label: api, value: api }));

const keyGoesToAuth = computed(
  () =>
    Boolean(draft.value.apiKey.trim()) &&
    !shouldStoreApiKeyInModelsJson(draft.value.apiKey, draft.value.baseUrl),
);

const docProviders = computed(() => {
  try {
    return listEditableProviders(parseModelsConfigText(props.modelsText));
  } catch {
    return [] as CustomProviderDraft[];
  }
});

const selected = computed(
  () => docProviders.value.find((p) => p.id === selectedId.value) ?? null,
);

watch(
  () => props.startAdd,
  (v) => {
    if (v) beginAdd();
  },
);

watch(
  docProviders,
  (list) => {
    if (editing.value) return;
    if (selectedId.value && list.some((p) => p.id === selectedId.value)) return;
    selectedId.value = list[0]?.id ?? null;
  },
  { immediate: true },
);

function nextRowKey(): string {
  rowKeySeq += 1;
  return `m-${rowKeySeq}`;
}

function resetModelRowKeys(count: number): void {
  modelRowKeys.value = Array.from({ length: count }, () => nextRowKey());
}

function cloneDraft(src: CustomProviderDraft): CustomProviderDraft {
  return {
    ...src,
    models: src.models.map((m) => ({ ...m })),
  };
}

function beginAdd(): void {
  isNew.value = true;
  editing.value = true;
  formError.value = null;
  selectedId.value = null;
  draft.value = cloneDraft(emptyCustomProvider());
  resetModelRowKeys(draft.value.models.length);
  emit("update:startAdd", false);
}

function applyPreset(presetId: string): void {
  const preset = CUSTOM_PROVIDER_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;
  const keepKey =
    draft.value.apiKey.trim() && draft.value.id === preset.draft.id
      ? draft.value.apiKey
      : preset.draft.apiKey;
  draft.value = cloneDraft({ ...preset.draft, apiKey: keepKey });
  resetModelRowKeys(draft.value.models.length);
  formError.value = null;
}

function beginEdit(id: string): void {
  const row = docProviders.value.find((p) => p.id === id);
  if (!row) return;
  selectedId.value = id;
  isNew.value = false;
  editing.value = true;
  formError.value = null;
  draft.value = cloneDraft(row);
  resetModelRowKeys(draft.value.models.length);
}

function cancelEdit(): void {
  editing.value = false;
  isNew.value = false;
  formError.value = null;
  if (!selectedId.value && docProviders.value[0]) {
    selectedId.value = docProviders.value[0].id;
  }
}

function addModelRow(): void {
  draft.value.models.push({ id: "", name: "", reasoning: false });
  modelRowKeys.value.push(nextRowKey());
}

function removeModelRow(index: number): void {
  if (draft.value.models.length <= 1) {
    draft.value.models = [{ id: "", name: "", reasoning: false }];
    resetModelRowKeys(1);
    return;
  }
  draft.value.models.splice(index, 1);
  modelRowKeys.value.splice(index, 1);
}

function firstModelId(models: CustomModelEntry[]): string {
  return models.map((m) => m.id.trim()).find(Boolean) ?? "";
}

async function fetchModels(): Promise<void> {
  if (fetching.value) return;
  draft.value.baseUrl = normalizeProviderBaseUrl(draft.value.baseUrl);
  if (!draft.value.baseUrl.trim()) {
    message.warning(t.modelsCustomBaseUrl);
    return;
  }
  fetching.value = true;
  try {
    const result = await window.api.models.discover({
      baseUrl: draft.value.baseUrl,
      apiKey: draft.value.apiKey,
      api: draft.value.api,
    });
    if (!result.ok) {
      message.error(`${t.modelsCustomFetchFail}: ${result.error}`, { duration: 7000 });
      return;
    }
    if (!result.models.length) {
      message.warning(t.modelsCustomPickEmpty);
      return;
    }
    // 拉起模型列表供用户勾选,而不是静默合并全部。
    discovered.value = result.models;
    pickedIds.value = new Set(result.models.map((m) => m.id));
    pickQuery.value = "";
    pickOpen.value = true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    fetching.value = false;
  }
}

async function testConnection(source: "draft" | "selected"): Promise<void> {
  if (testing.value) return;
  const cfg =
    source === "draft"
      ? {
          baseUrl: normalizeProviderBaseUrl(draft.value.baseUrl),
          apiKey: draft.value.apiKey,
          api: draft.value.api,
          modelId: firstModelId(draft.value.models),
          providerId: draft.value.id.trim() || undefined,
        }
      : selected.value
        ? {
            baseUrl: normalizeProviderBaseUrl(selected.value.baseUrl),
            apiKey: selected.value.apiKey,
            api: selected.value.api,
            modelId: firstModelId(selected.value.models),
            providerId: selected.value.id,
          }
        : null;
  if (!cfg) return;
  if (!cfg.baseUrl.trim()) {
    message.warning(t.modelsCustomBaseUrl);
    return;
  }
  if (!cfg.modelId) {
    message.warning(t.modelsCustomTestNeedModel);
    return;
  }
  if (source === "draft") draft.value.baseUrl = cfg.baseUrl;
  testing.value = true;
  try {
    const result = await window.api.models.testConnection(cfg);
    if (result.ok) {
      message.success(t.modelsCustomTestOk(result.latencyMs));
    } else {
      const latency =
        typeof result.latencyMs === "number" ? ` (${result.latencyMs} ms)` : "";
      message.error(`${t.modelsCustomTestFail}${latency}: ${result.error}`, {
        duration: 8000,
      });
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    testing.value = false;
  }
}

function buildCommitPayload(doc: ReturnType<typeof parseModelsConfigText>): {
  modelsText: string;
  apiKeys?: Record<string, string>;
} {
  const id = draft.value.id.trim();
  const next = isNew.value
    ? upsertCustomProvider(doc, draft.value)
    : renameCustomProvider(doc, selectedId.value || id, draft.value);
  const modelsText = stringifyModelsConfig(next);
  const key = draft.value.apiKey.trim();
  const apiKeys =
    key && !shouldStoreApiKeyInModelsJson(key, draft.value.baseUrl)
      ? { [id]: key }
      : undefined;
  return { modelsText, apiKeys };
}

function applyDraft(): void {
  draft.value.baseUrl = normalizeProviderBaseUrl(draft.value.baseUrl);
  let doc;
  try {
    doc = parseModelsConfigText(props.modelsText);
  } catch (err) {
    formError.value = err instanceof Error ? err.message : String(err);
    return;
  }
  const existingIds = Object.keys(doc.providers);
  const err = validateCustomProvider(draft.value, {
    editingId: isNew.value ? null : selectedId.value,
    existingIds,
  });
  if (err) {
    formError.value = err;
    message.error(err);
    return;
  }
  formError.value = null;
  const payload = buildCommitPayload(doc);
  emit("update:modelsText", payload.modelsText);
  selectedId.value = draft.value.id.trim();
  editing.value = false;
  isNew.value = false;
  emit("commit", payload);
}

function confirmDelete(id: string): void {
  dialog.warning({
    title: t.modelsCustomDelete,
    content: t.modelsCustomDeleteConfirm(id),
    positiveText: t.delete,
    negativeText: t.cancel,
    onPositiveClick: () => {
      try {
        const doc = parseModelsConfigText(props.modelsText);
        const next = removeCustomProvider(doc, id);
        const modelsText = stringifyModelsConfig(next);
        // Optimistic UI: drop from list immediately (before disk write finishes).
        emit("update:modelsText", modelsText);
        if (selectedId.value === id) {
          const remain = listEditableProviders(next);
          selectedId.value = remain[0]?.id ?? null;
        }
        if (editing.value && draft.value.id === id) {
          editing.value = false;
          isNew.value = false;
          formError.value = null;
        }
        emit("commit", {
          modelsText,
          clearProviderKeys: [id],
          successMessage: t.modelsCustomDeleted,
        });
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

function selectProvider(id: string): void {
  selectedId.value = id;
  editing.value = false;
  isNew.value = false;
  formError.value = null;
}

function modelPlaceholder(_m: CustomModelEntry, i: number): string {
  return i === 0 ? "LongCat-2.0" : t.modelsCustomModelId;
}
</script>

<template>
  <div class="custom-layout">
    <div class="left">
      <div class="left-head">
        <NText class="section-label">{{ t.modelsCustomList }}</NText>
        <NButton size="tiny" type="primary" secondary class="pi-interactive" @click="beginAdd">
          {{ t.modelsAdd }}
        </NButton>
      </div>
      <NScrollbar class="left-scroll">
        <button
          v-for="p in docProviders"
          :key="p.id"
          type="button"
          class="provider-row"
          :class="{ active: selectedId === p.id && !editing }"
          @click="selectProvider(p.id)"
        >
          <div class="meta">
            <div class="name">{{ p.name || p.id }}</div>
            <NText depth="3" style="font-size: 11px">
              {{ p.id }} · {{ t.modelsAvailableCount(p.models.filter((m) => m.id).length) }}
            </NText>
          </div>
        </button>
        <div v-if="!docProviders.length" class="empty-left">
          {{ t.modelsCustomEmpty }}
        </div>
      </NScrollbar>
    </div>

    <div class="right">
      <NScrollbar class="right-scroll">
        <template v-if="editing">
          <div class="form-head">
            <NText strong style="font-size: 14px">
              {{ isNew ? t.modelsCustomAddTitle : t.modelsCustomEditTitle }}
            </NText>
            <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
              {{ t.modelsCustomFormHint }}
            </NText>
          </div>

          <div v-if="isNew" class="presets">
            <div class="field-label">{{ t.modelsCustomPresets }}</div>
            <div class="preset-chips">
              <button
                v-for="p in CUSTOM_PROVIDER_PRESETS"
                :key="p.id"
                type="button"
                class="preset-chip pi-interactive"
                @click="applyPreset(p.id)"
              >
                <span class="preset-label">{{ p.label }}</span>
                <span class="preset-hint">{{ p.hint }}</span>
              </button>
            </div>
          </div>

          <section class="form-section">
            <div class="section-title">{{ t.modelsCustomSectionBasic }}</div>
            <div class="field-grid">
              <div class="field">
                <div class="field-label">{{ t.modelsCustomProviderId }}</div>
                <NInput
                  v-model:value="draft.id"
                  size="small"
                  :disabled="!isNew"
                  placeholder="longcat"
                />
              </div>
              <div class="field">
                <div class="field-label">{{ t.modelsCustomDisplayName }}</div>
                <NInput v-model:value="draft.name" size="small" placeholder="LongCat" />
              </div>
            </div>
            <div class="field">
              <div class="field-label">{{ t.modelsCustomBaseUrl }}</div>
              <NInput
                v-model:value="draft.baseUrl"
                size="small"
                placeholder="https://api.longcat.chat/openai/v1"
              />
              <NText depth="3" style="font-size: 11px; display: block; margin-top: 4px">
                {{ t.modelsCustomBaseUrlHint }}
              </NText>
            </div>
            <div class="field-grid">
              <div class="field">
                <div class="field-label">{{ t.modelsCustomApi }}</div>
                <NSelect v-model:value="draft.api" size="small" :options="apiOptions" />
              </div>
              <div class="field">
                <div class="field-label">{{ t.modelsCustomApiKey }}</div>
                <NInput
                  v-model:value="draft.apiKey"
                  size="small"
                  type="password"
                  show-password-on="click"
                  :placeholder="t.modelsCustomApiKeyHint"
                />
              </div>
            </div>
            <NText depth="3" style="font-size: 11px; display: block; margin-top: -4px">
              {{ keyGoesToAuth ? t.modelsCustomApiKeyAuthHint : t.modelsCustomApiKeyModelsHint }}
            </NText>
          </section>

          <section class="form-section">
            <div class="section-title">{{ t.modelsCustomSectionCompat }}</div>
            <div class="compat-row">
              <div class="compat-item">
                <div>
                  <div class="field-label">{{ t.modelsCustomDevRole }}</div>
                  <NText depth="3" style="font-size: 11px">{{ t.modelsCustomDevRoleHint }}</NText>
                </div>
                <NSwitch v-model:value="draft.supportsDeveloperRole" size="small" />
              </div>
              <div class="compat-item">
                <div>
                  <div class="field-label">{{ t.modelsCustomReasoningEffort }}</div>
                  <NText depth="3" style="font-size: 11px">{{ t.modelsCustomReasoningEffortHint }}</NText>
                </div>
                <NSwitch v-model:value="draft.supportsReasoningEffort" size="small" />
              </div>
            </div>
          </section>

          <section class="form-section">
            <div class="models-editor-head">
              <div>
                <div class="section-title" style="margin-bottom: 2px">{{ t.modelsCustomModels }}</div>
                <NText depth="3" style="font-size: 11px">{{ t.modelsCustomFetchHint }}</NText>
              </div>
              <NSpace :size="6">
                <NButton
                  size="tiny"
                  secondary
                  class="pi-interactive"
                  :loading="fetching"
                  :disabled="fetching || testing || saving"
                  @click="fetchModels"
                >
                  {{ fetching ? t.modelsCustomFetching : t.modelsCustomFetchModels }}
                </NButton>
                <NButton
                  size="tiny"
                  secondary
                  class="pi-interactive"
                  :loading="testing"
                  :disabled="testing || fetching || saving"
                  @click="testConnection('draft')"
                >
                  {{ testing ? t.modelsCustomTesting : t.modelsCustomTest }}
                </NButton>
                <NButton size="tiny" quaternary class="pi-interactive" @click="addModelRow">
                  {{ t.modelsCustomAddModel }}
                </NButton>
              </NSpace>
            </div>

            <div
              v-for="(m, i) in draft.models"
              :key="modelRowKeys[i] ?? `fallback-${i}`"
              class="model-edit-row"
            >
              <NInput
                v-model:value="m.id"
                size="small"
                class="m-id"
                :placeholder="modelPlaceholder(m, i)"
              />
              <NInput
                v-model:value="m.name"
                size="small"
                class="m-name"
                :placeholder="t.modelsCustomModelName"
              />
              <NInputNumber
                v-model:value="m.contextWindow"
                size="small"
                class="m-ctx"
                :min="1024"
                :step="1024"
                :show-button="false"
                :placeholder="t.modelsCustomContextWindow"
              />
              <NInputNumber
                v-model:value="m.maxTokens"
                size="small"
                class="m-max"
                :min="256"
                :step="256"
                :show-button="false"
                :placeholder="t.modelsCustomMaxTokens"
              />
              <div class="m-reason">
                <NText depth="3" style="font-size: 11px">{{ t.modelsCustomReasoning }}</NText>
                <NSwitch v-model:value="m.reasoning" size="small" />
              </div>
              <div class="m-reason">
                <NText depth="3" style="font-size: 11px">{{ t.modelsCustomVision }}</NText>
                <NSwitch v-model:value="m.vision" size="small" />
              </div>
              <NButton size="tiny" quaternary type="error" @click="removeModelRow(i)">
                {{ t.delete }}
              </NButton>
            </div>
          </section>

          <NText v-if="formError" type="error" style="font-size: 12px; display: block; margin-top: 8px">
            {{ formError }}
          </NText>

          <div class="form-actions">
            <NText depth="3" style="font-size: 11px; flex: 1">{{ t.modelsCustomSaveHint }}</NText>
            <NSpace :size="8">
              <NButton size="small" class="pi-interactive" :disabled="saving" @click="cancelEdit">
                {{ t.cancel }}
              </NButton>
              <NButton
                size="small"
                type="primary"
                class="pi-interactive"
                :loading="saving"
                :disabled="saving || fetching || testing"
                @click="applyDraft"
              >
                {{ t.modelsCustomSave }}
              </NButton>
            </NSpace>
          </div>
        </template>

        <template v-else-if="selected">
          <div class="detail-head">
            <div style="min-width: 0; flex: 1">
              <div class="detail-title">{{ selected.name || selected.id }}</div>
              <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
                {{ selected.id }} · {{ selected.api }}
              </NText>
            </div>
            <NSpace :size="6">
              <NButton
                size="tiny"
                secondary
                class="pi-interactive"
                :loading="testing"
                :disabled="testing || saving"
                @click="testConnection('selected')"
              >
                {{ testing ? t.modelsCustomTesting : t.modelsCustomTest }}
              </NButton>
              <NButton size="tiny" secondary class="pi-interactive" @click="beginEdit(selected.id)">
                {{ t.edit }}
              </NButton>
              <NButton
                size="tiny"
                secondary
                type="error"
                class="pi-interactive"
                :disabled="saving"
                @click="confirmDelete(selected.id)"
              >
                {{ t.delete }}
              </NButton>
            </NSpace>
          </div>

          <div class="field">
            <div class="field-label">{{ t.modelsCustomBaseUrl }}</div>
            <NText style="font-size: 12.5px; font-family: var(--font-mono); word-break: break-all">
              {{ selected.baseUrl || "—" }}
            </NText>
          </div>

          <div class="models-block">
            <NText style="font-size: 12px; font-weight: 600">
              {{ t.modelsAvailable(selected.models.filter((m) => m.id).length) }}
            </NText>
            <div
              v-for="m in selected.models.filter((x) => x.id)"
              :key="m.id"
              class="model-row"
            >
              <span class="model-name">{{ m.name || m.id }}</span>
              <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
                {{ m.id }}{{ m.reasoning ? " · reasoning" : "" }}{{
                  m.contextWindow ? ` · ctx ${m.contextWindow}` : ""
                }}{{ m.maxTokens ? ` · max ${m.maxTokens}` : "" }}
              </NText>
            </div>
          </div>
        </template>

        <div v-else class="empty-right">
          <NText depth="3">{{ t.modelsCustomSelectHint }}</NText>
          <NButton
            size="small"
            type="primary"
            secondary
            style="margin-top: 12px"
            class="pi-interactive"
            @click="beginAdd"
          >
            {{ t.modelsCustomAddTitle }}
          </NButton>
        </div>
      </NScrollbar>
    </div>

    <!-- 拉起模型列表:勾选要添加的模型,确认后才写入草稿行 -->
    <div v-if="pickOpen" class="pick-overlay" @click.self="pickOpen = false">
      <div class="pick-panel" role="dialog" :aria-label="t.modelsCustomPickTitle">
        <div class="pick-head">
          <NText strong style="font-size: 13px">{{ t.modelsCustomPickTitle }}</NText>
          <NButton size="tiny" quaternary @click="pickOpen = false">
            {{ t.close }}
          </NButton>
        </div>
        <NInput
          v-model:value="pickQuery"
          size="small"
          clearable
          :placeholder="t.modelsSearchProvider"
          style="margin-bottom: 8px"
        />
        <NScrollbar class="pick-scroll">
          <button
            v-for="m in filteredDiscovered"
            :key="m.id"
            type="button"
            class="pick-row"
            :class="{ picked: pickedIds.has(m.id) }"
            @click="togglePick(m.id)"
          >
            <span class="pick-check" aria-hidden="true" />
            <span class="pick-id">{{ m.id }}</span>
            <span v-if="m.name && m.name !== m.id" class="pick-name">{{ m.name }}</span>
          </button>
          <div v-if="!filteredDiscovered.length" class="pick-empty">
            {{ t.modelsCustomPickEmpty }}
          </div>
        </NScrollbar>
        <div class="pick-foot">
          <NSpace :size="6">
            <NButton size="tiny" quaternary class="pi-interactive" @click="pickAll">
              {{ t.modelsCustomPickAll }}
            </NButton>
            <NButton size="tiny" quaternary class="pi-interactive" @click="pickNone">
              {{ t.modelsCustomPickNone }}
            </NButton>
          </NSpace>
          <NButton
            size="tiny"
            type="primary"
            class="pi-interactive"
            :disabled="pickedIds.size === 0"
            @click="confirmPick"
          >
            {{ t.modelsCustomPickAdd(pickedIds.size) }}
          </NButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 0;
  flex: 1;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg);
}

/* 模型列表选择弹层(拉取模型后出现) */
.pick-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(9, 9, 11, 0.4);
  backdrop-filter: blur(2px);
}

.pick-panel {
  width: min(440px, 92vw);
  max-height: min(520px, 76vh);
  display: flex;
  flex-direction: column;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-panel, var(--bg));
  box-shadow: var(--shadow-lg, 0 12px 40px rgba(0, 0, 0, 0.3));
}

.pick-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.pick-scroll {
  min-height: 120px;
  max-height: 320px;
}

.pick-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.pick-row:hover {
  background: var(--bg-hover);
}

.pick-check {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border-radius: 4px;
  border: 1.5px solid var(--border-strong, var(--border));
  position: relative;
  transition:
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    border-color var(--duration-fast, 140ms) var(--ease-out, ease);
}

.pick-row.picked .pick-check {
  background: var(--accent);
  border-color: var(--accent);
}

.pick-row.picked .pick-check::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 0.5px;
  width: 4px;
  height: 7px;
  border: solid #fff;
  border-width: 0 1.6px 1.6px 0;
  transform: rotate(42deg);
  border-radius: 1px;
}

.pick-id {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-name {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-faint, var(--fg-muted));
  font-size: 11.5px;
}

.pick-empty {
  padding: 18px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--fg-faint, var(--fg-muted));
}

.pick-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.left {
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-panel) 92%, transparent);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.left-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
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
  padding: 10px 12px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.provider-row:hover {
  background: var(--bg-hover);
}

.provider-row.active {
  background: var(--bg-selected);
  border-left-color: var(--accent, #5b8def);
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
  padding: 18px 22px 22px;
}

.form-head {
  margin-bottom: 12px;
}

.form-section {
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
}

.section-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--fg-strong);
  margin-bottom: 10px;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}

.presets {
  margin-bottom: 14px;
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.preset-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  cursor: pointer;
  text-align: left;
  min-width: 120px;
}

.preset-chip:hover {
  border-color: var(--accent, #5b8def);
  background: var(--bg-hover);
}

.preset-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg-strong);
}

.preset-hint {
  font-size: 10.5px;
  color: var(--fg-faint);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.detail-title {
  font-size: 14px;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
}

.compat-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.compat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.models-editor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.model-edit-row {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) minmax(60px, 0.85fr) 80px 68px auto auto auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.m-ctx,
.m-max {
  width: 100%;
}

.m-reason {
  display: flex;
  align-items: center;
  gap: 6px;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.models-block {
  margin-top: 4px;
}

.model-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}

.model-name {
  font-weight: 500;
}

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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

@media (max-width: 720px) {
  .field-grid {
    grid-template-columns: 1fr;
  }

  .model-edit-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
