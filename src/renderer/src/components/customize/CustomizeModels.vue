<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NButton,
  NIcon,
  NInput,
  NInputNumber,
  NSelect,
  NSpin,
  NSwitch,
  useDialog,
  useMessage,
} from "naive-ui";
import { EyeOffOutline, EyeOutline } from "@vicons/ionicons5";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import ModelPickModal from "@renderer/components/customize/ModelPickModal.vue";
import {
  CUSTOM_MODEL_APIS,
  emptyCustomProvider,
  listEditableProviders,
  mergeDiscoveredIntoDraft,
  newModelEntry,
  parseModelsConfigText,
  removeCustomProvider,
  renameCustomProvider,
  stringifyModelsConfig,
  upsertCustomProvider,
  validateCustomProvider,
  type CustomModelEntry,
  type CustomProviderDraft,
} from "../../../../shared/custom-models";
import {
  normalizeProviderBaseUrl,
  type DiscoveredModel,
} from "../../../../shared/model-discover";
import { t } from "@renderer/i18n";

const message = useMessage();
const dialog = useDialog();

const loading = ref(true);
const loadError = ref("");
const modelsText = ref("");
const providers = ref<CustomProviderDraft[]>([]);

const selectedId = ref<string | null>(null);
const isNew = ref(false);
const draft = ref<CustomProviderDraft | null>(null);
const savedDraft = ref<CustomProviderDraft | null>(null);
/** API Key 默认以等长 * 掩码展示，点眼睛才显示明文。 */
const keyVisible = ref(false);
const saving = ref(false);
const discovering = ref(false);
const testing = ref(false);
const formError = ref("");

/** 「拉取模型」结果弹窗：手动勾选后再合并进模型列表。 */
const pickOpen = ref(false);
const pickRows = ref<DiscoveredModel[]>([]);

/** 模型行用稳定 key，删除行时不串输入框。 */
const modelRowKeys = ref<string[]>([]);
let rowKeySeq = 0;

const apiOptions = CUSTOM_MODEL_APIS.map((api) => ({ label: api, value: api }));

const dirty = computed(() => {
  if (!draft.value || !savedDraft.value) return false;
  return JSON.stringify(draft.value) !== JSON.stringify(savedDraft.value);
});

const keyMasked = computed(() => "*".repeat(draft.value?.apiKey.length ?? 0));

const modelCount = computed(
  () => draft.value?.models.filter((model) => model.id.trim()).length ?? 0,
);

const existingModelIds = computed(
  () => draft.value?.models.map((model) => model.id.trim()).filter(Boolean) ?? [],
);

onMounted(() => {
  void load();
});

function cloneDraft(src: CustomProviderDraft): CustomProviderDraft {
  return { ...src, models: src.models.map((model) => ({ ...model })) };
}

function nextRowKey(): string {
  rowKeySeq += 1;
  return `m-${rowKeySeq}`;
}

function resetRowKeys(count: number): void {
  modelRowKeys.value = Array.from({ length: count }, () => nextRowKey());
}

async function load(preferId?: string | null): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await window.api.models.get();
    modelsText.value = data.modelsText;
    providers.value = listEditableProviders(parseModelsConfigText(data.modelsText));
    const nextId =
      (preferId && providers.value.some((p) => p.id === preferId) ? preferId : null) ??
      (selectedId.value && providers.value.some((p) => p.id === selectedId.value)
        ? selectedId.value
        : null) ??
      providers.value[0]?.id ??
      null;
    if (nextId) selectProvider(nextId);
    else clearDraft();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function clearDraft(): void {
  selectedId.value = null;
  isNew.value = false;
  keyVisible.value = false;
  formError.value = "";
  draft.value = null;
  savedDraft.value = null;
  resetRowKeys(0);
}

function selectProvider(id: string): void {
  const row = providers.value.find((p) => p.id === id);
  if (!row) return;
  selectedId.value = id;
  isNew.value = false;
  keyVisible.value = false;
  formError.value = "";
  draft.value = cloneDraft(row);
  savedDraft.value = cloneDraft(row);
  resetRowKeys(row.models.length);
}

function beginAdd(): void {
  const blank = emptyCustomProvider({ baseUrl: "" });
  selectedId.value = null;
  isNew.value = true;
  keyVisible.value = false;
  formError.value = "";
  draft.value = cloneDraft(blank);
  savedDraft.value = cloneDraft(blank);
  resetRowKeys(blank.models.length);
}

/** 有未保存修改时先确认，再执行切换（新增 / 选择其它提供商）。 */
function confirmDiscard(run: () => void): void {
  if (!dirty.value) {
    run();
    return;
  }
  dialog.warning({
    title: t.modelsCustomDirty,
    content: t.modelsCustomDiscardConfirm,
    positiveText: t.modelsCustomReset,
    negativeText: t.cancel,
    onPositiveClick: run,
  });
}

function onSelectProvider(id: string): void {
  if (id === selectedId.value && !isNew.value) return;
  confirmDiscard(() => selectProvider(id));
}

function onAddProvider(): void {
  confirmDiscard(beginAdd);
}

function resetDraft(): void {
  if (!draft.value || !savedDraft.value) return;
  const count = savedDraft.value.models.length;
  draft.value = cloneDraft(savedDraft.value);
  keyVisible.value = false;
  formError.value = "";
  resetRowKeys(count);
}

function addModelRow(): void {
  if (!draft.value) return;
  draft.value.models.push(newModelEntry());
  modelRowKeys.value = [...modelRowKeys.value, nextRowKey()];
}

function removeModelRow(index: number): void {
  const current = draft.value;
  if (!current) return;
  current.models.splice(index, 1);
  modelRowKeys.value = modelRowKeys.value.filter((_, i) => i !== index);
  if (!current.models.length) {
    current.models.push(newModelEntry());
    modelRowKeys.value = [...modelRowKeys.value, nextRowKey()];
  }
}

function setModelNumber(
  model: CustomModelEntry,
  key: "contextWindow" | "maxTokens",
  value: number | null,
): void {
  if (value === null || !Number.isFinite(value) || value <= 0) delete model[key];
  else model[key] = Math.floor(value);
}

function onApiKeyInput(value: string): void {
  if (!draft.value) return;
  draft.value.apiKey = value;
}

function setCompat(
  key: "supportsDeveloperRole" | "supportsReasoningEffort",
  value: boolean,
): void {
  if (draft.value) draft.value[key] = value;
}

function providerHint(provider: CustomProviderDraft): string {
  if (!provider.baseUrl) return provider.api;
  try {
    return new URL(provider.baseUrl).host;
  } catch {
    return provider.baseUrl;
  }
}

function providerModelCount(provider: CustomProviderDraft): number {
  return provider.models.filter((model) => model.id.trim()).length;
}

function localValidationError(current: CustomProviderDraft): string {
  const id = current.id.trim();
  if (!id) return t.modelsCustomIdRequired;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) return t.modelsCustomIdInvalid;
  if (!current.baseUrl.trim()) return t.modelsCustomBaseUrlRequired;
  try {
    // eslint-disable-next-line no-new
    new URL(normalizeProviderBaseUrl(current.baseUrl) || current.baseUrl.trim());
  } catch {
    return t.modelsCustomBaseUrlInvalid;
  }
  if (providers.value.some((p) => p.id === id && p.id !== selectedId.value)) {
    return t.modelsCustomIdExists(id);
  }
  const modelIds = current.models.map((model) => model.id.trim()).filter(Boolean);
  if (!modelIds.length) return t.modelsCustomModelsRequired;
  if (new Set(modelIds).size !== modelIds.length) return t.modelsCustomModelsDuplicate;
  return "";
}

async function save(): Promise<void> {
  const current = draft.value;
  if (!current || saving.value) return;
  current.baseUrl = normalizeProviderBaseUrl(current.baseUrl);
  const localError = localValidationError(current);
  if (localError) {
    formError.value = localError;
    message.error(localError);
    return;
  }
  const id = current.id.trim();
  saving.value = true;
  try {
    const doc = parseModelsConfigText(modelsText.value);
    const invalid = validateCustomProvider(current, {
      editingId: isNew.value ? null : selectedId.value,
      existingIds: Object.keys(doc.providers),
    });
    if (invalid) {
      formError.value = invalid;
      message.error(invalid);
      return;
    }
    const previousId = isNew.value ? "" : (selectedId.value ?? id).trim();
    const next = isNew.value
      ? upsertCustomProvider(doc, current)
      : renameCustomProvider(doc, previousId, current);
    await window.api.models.set({
      modelsText: stringifyModelsConfig(next),
      // 旧 auth.json 凭据优先于 models.json，同名条目必须一并清除。
      clearAuth: [...new Set([id, previousId].filter(Boolean))],
    });
    await load(id);
    formError.value = "";
    notifyModelsChanged();
    message.success(t.modelsCustomSaved);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    formError.value = text;
    message.error(text);
  } finally {
    saving.value = false;
  }
}

function confirmDelete(): void {
  const current = draft.value;
  if (!current) return;
  const id = (selectedId.value ?? current.id.trim()).trim();
  if (!id) return;
  dialog.warning({
    title: t.modelsCustomDelete,
    content: t.modelsCustomDeleteConfirm(id),
    positiveText: t.delete,
    negativeText: t.cancel,
    onPositiveClick: async () => {
      try {
        const doc = parseModelsConfigText(modelsText.value);
        const next = removeCustomProvider(doc, id);
        await window.api.models.set({
          modelsText: stringifyModelsConfig(next),
          clearAuth: [id],
        });
        selectedId.value = null;
        await load(null);
        notifyModelsChanged();
        message.success(t.modelsCustomDeleted);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

async function discover(): Promise<void> {
  const current = draft.value;
  if (!current || discovering.value) return;
  current.baseUrl = normalizeProviderBaseUrl(current.baseUrl);
  if (!current.baseUrl.trim()) {
    message.warning(t.modelsCustomBaseUrlRequired);
    return;
  }
  discovering.value = true;
  try {
    const result = await window.api.models.discover({
      baseUrl: current.baseUrl,
      apiKey: current.apiKey.trim() || undefined,
      api: current.api,
    });
    if (result.ok && result.models.length) {
      pickRows.value = result.models;
      pickOpen.value = true;
    } else if (result.ok) {
      message.warning(t.modelsCustomDiscoverEmpty);
    } else {
      message.error(`${t.modelsCustomDiscoverFail}: ${result.error}`, { duration: 8000 });
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    discovering.value = false;
  }
}

function applyPickedModels(picked: DiscoveredModel[]): void {
  const current = draft.value;
  if (!current || !picked.length) return;
  current.models = mergeDiscoveredIntoDraft(current.models, picked);
  resetRowKeys(current.models.length);
  pickOpen.value = false;
  message.success(t.modelsCustomDiscoverOk(picked.length));
}

/** 通知 Composer 刷新模型选择器（models.json 已变化）。 */
function notifyModelsChanged(): void {
  window.dispatchEvent(new CustomEvent("pi-models-changed"));
}

async function testConnection(): Promise<void> {
  const current = draft.value;
  if (!current || testing.value) return;
  current.baseUrl = normalizeProviderBaseUrl(current.baseUrl);
  if (!current.baseUrl.trim()) {
    message.warning(t.modelsCustomTestNoBaseUrl);
    return;
  }
  const modelId = current.models.map((model) => model.id.trim()).find(Boolean) ?? "";
  if (!modelId) {
    message.warning(t.modelsCustomTestNoModel);
    return;
  }
  testing.value = true;
  try {
    const result = await window.api.models.testConnection({
      baseUrl: current.baseUrl,
      apiKey: current.apiKey.trim() || undefined,
      api: current.api,
      modelId,
      providerId: current.id.trim() || undefined,
    });
    if (result.ok) message.success(t.modelsCustomTestOk(result.latencyMs));
    else message.error(`${t.modelsCustomTestFail}: ${result.error}`, { duration: 8000 });
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="customize-models">
    <NSpin v-if="loading" size="small" class="content-spin" />

    <p v-else-if="loadError" class="content-error">
      {{ t.customizeLoadFailed }}: {{ loadError }}
    </p>

    <div v-else class="models-layout">
      <aside class="models-sidebar">
        <div class="list-toolbar">
          <NButton size="small" @click="onAddProvider">
            <template #icon><CodiconIcon name="add" :size="13" /></template>
            {{ t.modelsCustomAdd }}
          </NButton>
        </div>

        <div v-if="!providers.length" class="sidebar-empty">
          <span class="sidebar-empty-title">{{ t.modelsCustomEmpty }}</span>
          <span class="sidebar-empty-hint">{{ t.modelsCustomEmptyHint }}</span>
        </div>

        <div v-else class="provider-list">
          <button
            v-for="provider in providers"
            :key="provider.id"
            type="button"
            class="provider-item"
            :class="{ selected: provider.id === selectedId && !isNew }"
            @click="onSelectProvider(provider.id)"
          >
            <span class="provider-name">{{ provider.name || provider.id }}</span>
            <span class="provider-sub">
              {{ providerHint(provider) }}
              <template v-if="providerModelCount(provider)">
                · {{ t.modelsCustomCount(providerModelCount(provider)) }}
              </template>
            </span>
          </button>
        </div>
      </aside>

      <section class="models-detail">
        <div v-if="!draft" class="detail-empty">
          <span class="detail-empty-title">{{ t.modelsCustomSelectHint }}</span>
        </div>

        <template v-else>
          <header class="detail-header">
            <h3 class="detail-title">{{ isNew ? t.modelsCustomNew : draft.name || draft.id }}</h3>
            <span v-if="dirty" class="inline-badge">{{ t.modelsCustomDirty }}</span>
            <span class="detail-spacer" />
            <NButton v-if="!isNew" size="tiny" quaternary type="error" @click="confirmDelete">
              <template #icon><CodiconIcon name="remove" :size="13" /></template>
              {{ t.modelsCustomDelete }}
            </NButton>
          </header>

          <div class="detail-scroll">
            <p v-if="formError" class="form-error">{{ formError }}</p>

            <div class="form-section">
              <div class="form-section-title">{{ t.modelsCustomSectionBasic }}</div>

              <div class="field">
                <label class="field-label" :title="t.modelsCustomIdHint">
                  {{ t.modelsCustomId }}
                </label>
                <div class="field-control">
                  <NInput
                    v-model:value="draft.id"
                    size="small"
                    :placeholder="t.modelsCustomId"
                  />
                </div>
              </div>

              <div class="field">
                <label class="field-label">{{ t.modelsCustomName }}</label>
                <div class="field-control">
                  <NInput
                    v-model:value="draft.name"
                    size="small"
                    :placeholder="t.modelsCustomNamePlaceholder"
                  />
                </div>
              </div>

              <div class="field">
                <label class="field-label">{{ t.modelsCustomBaseUrl }}</label>
                <div class="field-control">
                  <NInput
                    v-model:value="draft.baseUrl"
                    size="small"
                    :placeholder="t.modelsCustomBaseUrlHint"
                  />
                </div>
              </div>

              <div class="field">
                <label class="field-label">{{ t.modelsCustomApi }}</label>
                <div class="field-control">
                  <NSelect v-model:value="draft.api" size="small" :options="apiOptions" />
                </div>
              </div>

              <div class="field">
                <label class="field-label">{{ t.modelsCustomApiKey }}</label>
                <div class="field-control">
                  <NInput
                    :value="keyVisible ? draft.apiKey : keyMasked"
                    size="small"
                    :placeholder="t.modelsCustomApiKeyPlaceholder"
                    @focus="keyVisible = true"
                    @update:value="onApiKeyInput"
                  >
                    <template #suffix>
                      <button
                        type="button"
                        class="key-eye"
                        :title="keyVisible ? t.modelsCustomKeyHide : t.modelsCustomKeyShow"
                        @click="keyVisible = !keyVisible"
                      >
                        <NIcon
                          :component="keyVisible ? EyeOffOutline : EyeOutline"
                          :size="14"
                        />
                      </button>
                    </template>
                  </NInput>
                </div>
              </div>

              <p class="field-hint">{{ t.modelsCustomApiKeyHint }}</p>
            </div>

            <div class="form-section">
              <div class="form-section-title">{{ t.modelsCustomSectionCompat }}</div>

              <label class="toggle-row">
                <NSwitch
                  size="small"
                  :value="draft.supportsDeveloperRole"
                  @update:value="
                    (value: boolean) => setCompat('supportsDeveloperRole', value)
                  "
                />
                <span class="toggle-text">{{ t.modelsCustomDevRole }}</span>
                <span class="toggle-hint">{{ t.modelsCustomDevRoleHint }}</span>
              </label>

              <label class="toggle-row">
                <NSwitch
                  size="small"
                  :value="draft.supportsReasoningEffort"
                  @update:value="
                    (value: boolean) => setCompat('supportsReasoningEffort', value)
                  "
                />
                <span class="toggle-text">{{ t.modelsCustomReasoningEffort }}</span>
                <span class="toggle-hint">{{ t.modelsCustomReasoningEffortHint }}</span>
              </label>
            </div>

            <div class="form-section">
              <div class="form-section-title-row">
                <span class="form-section-title">{{ t.modelsCustomSectionModels }}</span>
                <span class="detail-spacer" />
                <NButton size="tiny" secondary @click="addModelRow">
                  {{ t.modelsCustomAddModel }}
                </NButton>
              </div>

              <div class="model-list">
                <div
                  v-for="(model, index) in draft.models"
                  :key="modelRowKeys[index] ?? index"
                  class="model-row"
                >
                  <div class="model-row-main">
                    <NInput
                      v-model:value="model.id"
                      size="small"
                      :placeholder="t.modelsCustomModelId"
                    />
                    <NInput
                      v-model:value="model.name"
                      size="small"
                      :placeholder="t.modelsCustomModelName"
                    />
                    <button
                      type="button"
                      class="model-remove"
                      :title="t.customizeDelete"
                      @click="removeModelRow(index)"
                    >
                      <CodiconIcon name="remove" :size="14" />
                    </button>
                  </div>

                  <div class="model-row-meta">
                    <NInputNumber
                      size="small"
                      class="model-number"
                      :title="t.modelsCustomContextWindow"
                      :value="model.contextWindow ?? null"
                      :min="1"
                      :show-button="false"
                      :placeholder="t.modelsCustomContextWindow"
                      @update:value="(value: number | null) => setModelNumber(model, 'contextWindow', value)"
                    />
                    <NInputNumber
                      size="small"
                      class="model-number"
                      :title="t.modelsCustomMaxTokens"
                      :value="model.maxTokens ?? null"
                      :min="1"
                      :show-button="false"
                      :placeholder="t.modelsCustomMaxTokens"
                      @update:value="(value: number | null) => setModelNumber(model, 'maxTokens', value)"
                    />
                    <label class="cap-toggle">
                      <NSwitch
                        size="small"
                        :value="model.reasoning"
                        @update:value="(value: boolean) => (model.reasoning = value)"
                      />
                      <span>{{ t.modelsCustomReasoning }}</span>
                    </label>
                    <label class="cap-toggle">
                      <NSwitch
                        size="small"
                        :value="model.vision === true"
                        @update:value="(value: boolean) => (model.vision = value)"
                      />
                      <span>{{ t.modelsCustomVision }}</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <footer class="detail-footer">
            <NButton
              size="small"
              :loading="testing"
              :disabled="modelCount === 0"
              @click="testConnection"
            >
              {{ testing ? t.modelsCustomTesting : t.modelsCustomTest }}
            </NButton>
            <NButton size="small" :loading="discovering" @click="discover">
              {{ discovering ? t.modelsCustomDiscovering : t.modelsCustomDiscover }}
            </NButton>
            <span class="detail-spacer" />
            <NButton size="small" :disabled="!dirty" @click="resetDraft">
              {{ t.modelsCustomReset }}
            </NButton>
            <NButton size="small" type="primary" :loading="saving" :disabled="!dirty" @click="save">
              {{ t.modelsCustomSave }}
            </NButton>
          </footer>
        </template>
      </section>
    </div>

    <ModelPickModal
      :show="pickOpen"
      :models="pickRows"
      :existing-ids="existingModelIds"
      @close="pickOpen = false"
      @confirm="applyPickedModels"
    />
  </div>
</template>

<style scoped>
.customize-models {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding-top: 8px;
}

.models-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 12px;
}

.models-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 190px;
  min-height: 0;
  border-right: 1px solid var(--border);
  padding-right: 8px;
}

.list-toolbar {
  flex-shrink: 0;
  margin-bottom: 8px;
}

.sidebar-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 4px;
}

.sidebar-empty-title {
  color: var(--fg);
  font-size: 12px;
  font-weight: 600;
}

.sidebar-empty-hint {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.45;
}

.provider-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.provider-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.provider-item:hover {
  background-color: var(--bg-hover);
}

.provider-item.selected {
  background-color: var(--bg-active);
}

.provider-name {
  overflow: hidden;
  color: var(--fg);
  font-size: 12.5px;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-sub {
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.models-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 48px 24px;
}

.detail-empty-title {
  color: var(--fg-muted);
  font-size: 13px;
}

.detail-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.detail-title {
  margin: 0;
  overflow: hidden;
  color: var(--fg);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-spacer {
  flex: 1;
  min-width: 0;
}

.inline-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--bg-active);
  color: var(--fg-muted);
  font-size: 10px;
  line-height: 16px;
}

.detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 4px 12px 0;
}

.form-error {
  margin: 0 0 12px;
  color: var(--error);
  font-size: 12px;
}

.form-section {
  margin-bottom: 18px;
}

.form-section-title {
  margin-bottom: 8px;
  color: var(--fg);
  font-size: 12px;
  font-weight: 600;
}

.form-section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.form-section-title-row .form-section-title {
  margin-bottom: 0;
}

.field {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.field-label {
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-control {
  min-width: 0;
}

.key-eye {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.key-eye:hover {
  background: var(--bg-active);
  color: var(--fg);
}

.field-hint {
  margin: 0;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.45;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.toggle-text {
  color: var(--fg);
  font-size: 12px;
}

.toggle-hint {
  color: var(--fg-muted);
  font-size: 11px;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.model-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-row-main > :first-child {
  flex: 1.2;
  min-width: 0;
}

.model-row-main > :nth-child(2) {
  flex: 1;
  min-width: 0;
}

.model-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.model-remove:hover {
  background: var(--bg-active);
  color: var(--error);
}

.model-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.model-number {
  width: 118px;
}

.cap-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-muted);
  font-size: 11.5px;
  cursor: pointer;
}

.detail-footer {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.content-error {
  margin: 0;
  color: var(--error);
  font-size: 12px;
}

.content-spin {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}
</style>
