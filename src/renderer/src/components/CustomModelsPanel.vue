<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NText,
  NTooltip,
  NScrollbar,
  useDialog,
  useMessage,
} from "naive-ui";
import { AddOutline, CloudDownloadOutline, FlashOutline, ImageOutline, ListOutline, SparklesOutline, TrashOutline } from "@vicons/ionicons5";
import {
  CUSTOM_MODEL_APIS,
  emptyCustomProvider,
  listEditableProviders,
  mergeDiscoveredIntoDraft,
  newModelEntry,
  parseBulkModelTokens,
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
import { findCustomPlatform } from "../../../shared/provider-catalog";
import { DEFAULT_MAX_TOKENS, inferModelCapabilities } from "../../../shared/model-metadata";
import { normalizeProviderBaseUrl, type DiscoveredModel } from "../../../shared/model-discover";
import type { PickerRow } from "../../../shared/model-picker";
import ProviderIcon from "@renderer/components/ProviderIcon.vue";
import ModelPickerModal from "@renderer/components/ModelPickerModal.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{
  modelsText: string;
  /** When true, start a blank “add provider” form. */
  startAdd?: boolean;
  /** Platform id from the catalog to prefill the new draft with. */
  startPlatformId?: string | null;
  /** Parent is writing models.json / auth.json */
  saving?: boolean;
}>();

const emit = defineEmits<{
  "update:modelsText": [string];
  "update:startAdd": [boolean];
  "update:startPlatformId": [string | null];
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

/** Fetch-from-provider flow: the picker opens immediately, then fills. */
const pickOpen = ref(false);
const pickLoading = ref(false);
const pickError = ref<string | null>(null);
const discovered = ref<DiscoveredModel[]>([]);

/**
 * Per-row manual capability overrides, keyed by the stable row key.
 *
 * Declared up here on purpose: `resetModelRowKeys()` runs from an `immediate`
 * watcher during setup, so this ref must exist before that fires.
 */
const manualCaps = ref<Record<string, { reasoning?: boolean; vision?: boolean }>>({});

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

const filledModels = computed(() => draft.value.models.filter((m) => m.id.trim()).length);

/**
 * `immediate` matters: the parent may flip `startAdd` while this pane is not yet
 * mounted (platform picked from another tab), so the flag must be honoured on
 * mount as well as on change.
 */
watch(
  () => props.startAdd,
  (v) => {
    if (v) beginAdd(props.startPlatformId ?? null);
  },
  { immediate: true },
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

/**
 * Rebuild the stable row keys after the model list changes, then re-run
 * capability detection. Every rebuild path goes through here, so the
 * `reasoning` / `vision` flags always end up auto-filled.
 *
 * Pass `autoDetect: false` when the caller needs to seed manual overrides from
 * saved data first (see {@link beginEdit}).
 */
function resetModelRowKeys(count: number, opts?: { autoDetect?: boolean }): void {
  modelRowKeys.value = Array.from({ length: count }, () => nextRowKey());
  resetManualCaps();
  if (opts?.autoDetect !== false) autoDetectAll();
}

/**
 * Treat capabilities a saved provider explicitly turned **on** as manual
 * overrides, so re-opening the form cannot silently drop them.
 *
 * A stored `false`/absent value means "never decided", so detection is free to
 * fill it in — that is what removes the hand-ticking the form used to require.
 */
function seedManualCapsFromStored(): void {
  const seeded: Record<string, { reasoning?: boolean; vision?: boolean }> = {};
  draft.value.models.forEach((model, i) => {
    const key = modelRowKeys.value[i];
    if (!key) return;
    const entry: { reasoning?: boolean; vision?: boolean } = {};
    if (model.reasoning) entry.reasoning = true;
    if (model.vision) entry.vision = true;
    if (Object.keys(entry).length) seeded[key] = entry;
  });
  manualCaps.value = seeded;
}

function cloneDraft(src: CustomProviderDraft): CustomProviderDraft {
  return {
    ...src,
    models: src.models.map((m) => ({ ...m })),
  };
}

/** Build a draft from a catalog platform (or a blank one when unknown). */
function platformDraft(platformId: string | null): CustomProviderDraft {
  const spec = platformId ? findCustomPlatform(platformId) : null;
  if (!spec) {
    const blank = emptyCustomProvider();
    blank.baseUrl = "";
    blank.apiKey = "";
    return blank;
  }
  return emptyCustomProvider({
    id: spec.id === "openai-compatible" ? "" : spec.id,
    name: spec.id === "openai-compatible" ? "" : spec.name,
    baseUrl: spec.baseUrl,
    api: spec.api,
    apiKey: spec.apiKey ?? "",
    supportsDeveloperRole: spec.supportsDeveloperRole,
    supportsReasoningEffort: spec.supportsReasoningEffort,
    models: [newModelEntry()],
  });
}

function beginAdd(platformId: string | null = null): void {
  isNew.value = true;
  editing.value = true;
  formError.value = null;
  selectedId.value = null;
  draft.value = platformDraft(platformId);
  resetModelRowKeys(draft.value.models.length);
  emit("update:startAdd", false);
  emit("update:startPlatformId", null);
}

function beginEdit(id: string): void {
  const row = docProviders.value.find((p) => p.id === id);
  if (!row) return;
  selectedId.value = id;
  isNew.value = false;
  editing.value = true;
  formError.value = null;
  draft.value = cloneDraft(row);
  // Seed saved "on" flags first, then let detection fill in everything else.
  resetModelRowKeys(draft.value.models.length, { autoDetect: false });
  seedManualCapsFromStored();
  autoDetectAll();
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
  draft.value.models.push(newModelEntry());
  modelRowKeys.value.push(nextRowKey());
}

/* -------------------------------------------------------------------------- */
/* Capability auto-detection                                                  */
/* -------------------------------------------------------------------------- */

function rowKeyAt(index: number): string | undefined {
  return modelRowKeys.value[index];
}

function isManual(index: number, flag: "reasoning" | "vision"): boolean {
  const key = rowKeyAt(index);
  return Boolean(key && manualCaps.value[key]?.[flag] !== undefined);
}

/** Re-run detection for every row whose flag the user has not overridden. */
function autoDetectAll(): void {
  for (let i = 0; i < draft.value.models.length; i += 1) autoDetectRow(i);
}

/** Detect capabilities for one row, respecting manual overrides. */
function autoDetectRow(index: number): void {
  const model = draft.value.models[index];
  const key = rowKeyAt(index);
  if (!model || !key) return;
  const manual = manualCaps.value[key];
  const caps = inferModelCapabilities(model.id);
  if (manual?.reasoning === undefined) model.reasoning = caps.reasoning;
  if (manual?.vision === undefined) model.vision = caps.vision;
}

/** Click a chip to override the detected value. */
function toggleCapability(index: number, flag: "reasoning" | "vision"): void {
  const model = draft.value.models[index];
  const key = rowKeyAt(index);
  if (!model || !key) return;
  const next = !model[flag];
  model[flag] = next;
  manualCaps.value = {
    ...manualCaps.value,
    [key]: { ...manualCaps.value[key], [flag]: next },
  };
}

/** Drop every override — used when the row list is rebuilt. */
function resetManualCaps(): void {
  manualCaps.value = {};
}

/** XHigh / Max 默认开启；点击一次写 false（保存时落成 null）即关闭。 */
function toggleExtendedThinking(index: number, flag: "thinkingXhigh" | "thinkingMax"): void {
  const model = draft.value.models[index];
  if (!model) return;
  model[flag] = model[flag] === false;
}

function capTooltip(index: number, flag: "reasoning" | "vision"): string {
  const model = draft.value.models[index];
  if (!model?.id.trim()) return t.modelsCustomCapsNeedId;
  const label = flag === "reasoning" ? t.modelsCustomReasoning : t.modelsCustomVision;
  if (isManual(index, flag)) {
    return t.modelsCustomCapsManual(label, model[flag]);
  }
  return t.modelsCustomCapsAuto(label, model[flag]);
}

/** Drop every row, leaving a single blank one — then refetch or bulk-add. */
function clearModelRows(): void {
  const filled = draft.value.models.filter((m) => m.id.trim()).length;
  const apply = (): void => {
    draft.value.models = [newModelEntry()];
    resetModelRowKeys(1);
    message.success(t.modelsCustomCleared);
  };
  if (filled <= 1) {
    apply();
    return;
  }
  dialog.warning({
    title: t.modelsCustomClearAll,
    content: t.modelsCustomClearConfirm(draft.value.models.length),
    positiveText: t.modelsCustomClearAll,
    negativeText: t.cancel,
    onPositiveClick: apply,
  });
}

/** Bulk-add rows from pasted text (`id` or `id=Display name`). */
const bulkOpen = ref(false);
const bulkText = ref("");

function openBulkAdd(): void {
  bulkText.value = "";
  bulkOpen.value = true;
}

const bulkParsed = computed(() => parseBulkModelTokens(bulkText.value));

function applyBulkAdd(): void {
  const parsed = bulkParsed.value;
  if (!parsed.length) {
    message.warning(t.modelsCustomBulkEmpty);
    return;
  }
  // Reuse the merge helper so existing rows keep their manual limits.
  draft.value.models = mergeDiscoveredIntoDraft(
    draft.value.models,
    parsed.map((p) => ({ id: p.id, name: p.name || undefined })),
  );
  resetModelRowKeys(draft.value.models.length);
  bulkOpen.value = false;
  message.success(t.modelsCustomBulkAdded(parsed.length));
}

function removeModelRow(index: number): void {
  if (draft.value.models.length <= 1) {
    draft.value.models = [newModelEntry()];
    resetModelRowKeys(1);
    return;
  }
  draft.value.models.splice(index, 1);
  modelRowKeys.value.splice(index, 1);
}

function firstModelId(models: CustomModelEntry[]): string {
  return models.map((m) => m.id.trim()).find(Boolean) ?? "";
}

/** Open the picker right away so the click has immediate feedback. */
async function fetchModels(): Promise<void> {
  if (fetching.value) return;
  draft.value.baseUrl = normalizeProviderBaseUrl(draft.value.baseUrl);
  if (!draft.value.baseUrl.trim()) {
    message.warning(t.modelsCustomBaseUrl);
    return;
  }
  fetching.value = true;
  pickError.value = null;
  discovered.value = [];
  pickLoading.value = true;
  pickOpen.value = true;
  try {
    const result = await window.api.models.discover({
      baseUrl: draft.value.baseUrl,
      apiKey: draft.value.apiKey,
      api: draft.value.api,
    });
    if (result.ok && result.models.length) {
      discovered.value = result.models;
    } else if (result.ok) {
      pickError.value = t.modelsCustomPickEmpty;
    } else {
      pickError.value = result.error;
    }
  } catch (err) {
    pickError.value = err instanceof Error ? err.message : String(err);
  } finally {
    pickLoading.value = false;
    fetching.value = false;
  }
}

function applyPickedModels(rows: PickerRow[]): void {
  draft.value.models = mergeDiscoveredIntoDraft(draft.value.models, rows);
  resetModelRowKeys(draft.value.models.length);
  pickOpen.value = false;
  message.success(t.modelsPickAdded(rows.length));
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
</script>

<template>
  <div class="custom-layout">
    <div class="left">
      <div class="left-head">
        <NText class="section-label">{{ t.modelsCustomList }}</NText>
        <NButton size="tiny" type="primary" secondary class="pi-interactive" @click="beginAdd(null)">
          <template #icon>
            <NIcon :component="AddOutline" :size="13" />
          </template>
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
          <ProviderIcon :provider="p.id" :size="24" />
          <div class="meta">
            <div class="name">{{ p.name || p.id }}</div>
            <NText depth="3" style="font-size: 11px">
              {{ t.modelsAvailableCount(p.models.filter((m) => m.id).length) }}
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
          <header class="form-hero">
            <ProviderIcon :provider="draft.id || 'openai-compatible'" :size="40" />
            <div class="hero-text">
              <div class="hero-title">
                {{ isNew ? t.modelsCustomAddTitle : t.modelsCustomEditTitle }}
              </div>
              <NText depth="3" style="font-size: 11.5px">{{ t.modelsCustomFormHint }}</NText>
            </div>
          </header>

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
                  <NText depth="3" style="font-size: 11px">{{
                    t.modelsCustomReasoningEffortHint
                  }}</NText>
                </div>
                <NSwitch v-model:value="draft.supportsReasoningEffort" size="small" />
              </div>
            </div>
          </section>

          <section class="form-section">
            <div class="models-editor-head">
              <div>
                <div class="section-title" style="margin-bottom: 2px">
                  {{ t.modelsCustomModels }}
                  <span v-if="filledModels" class="count-pill">{{ filledModels }}</span>
                </div>
                <NText depth="3" style="font-size: 11px">{{ t.modelsCustomFetchHint }}</NText>
              </div>
              <NSpace :size="6">
                <NButton
                  size="small"
                  type="primary"
                  secondary
                  class="pi-interactive"
                  :loading="fetching"
                  :disabled="fetching || testing || saving"
                  @click="fetchModels"
                >
                  <template #icon>
                    <NIcon :component="CloudDownloadOutline" :size="14" />
                  </template>
                  {{ fetching ? t.modelsCustomFetching : t.modelsCustomFetchModels }}
                </NButton>
                <NButton
                  size="small"
                  secondary
                  class="pi-interactive"
                  :loading="testing"
                  :disabled="testing || fetching || saving"
                  @click="testConnection('draft')"
                >
                  <template #icon>
                    <NIcon :component="FlashOutline" :size="14" />
                  </template>
                  {{ testing ? t.modelsCustomTesting : t.modelsCustomTest }}
                </NButton>
                <NButton size="small" quaternary class="pi-interactive" @click="addModelRow">
                  <template #icon>
                    <NIcon :component="AddOutline" :size="14" />
                  </template>
                  {{ t.modelsCustomAddModel }}
                </NButton>
                <NButton size="small" quaternary class="pi-interactive" @click="openBulkAdd">
                  <template #icon>
                    <NIcon :component="ListOutline" :size="14" />
                  </template>
                  {{ t.modelsCustomBulkAdd }}
                </NButton>
                <NButton
                  size="small"
                  quaternary
                  class="pi-interactive"
                  :disabled="!draft.models.some((m) => m.id.trim())"
                  @click="clearModelRows"
                >
                  <template #icon>
                    <NIcon :component="TrashOutline" :size="14" />
                  </template>
                  {{ t.modelsCustomClearAll }}
                </NButton>
              </NSpace>
            </div>

            <div class="model-cards">
              <div
                v-for="(m, i) in draft.models"
                :key="modelRowKeys[i] ?? `fallback-${i}`"
                class="model-edit-row"
              >
                <div class="mer-top">
                  <NInput
                    v-model:value="m.id"
                    size="small"
                    class="mer-id"
                    placeholder="LongCat-2.0"
                    @blur="autoDetectRow(i)"
                  />
                  <NInput
                    v-model:value="m.name"
                    size="small"
                    class="mer-name"
                    :placeholder="t.modelsCustomModelName"
                  />
                  <NButton
                    size="tiny"
                    quaternary
                    type="error"
                    class="mer-del"
                    @click="removeModelRow(i)"
                  >
                    {{ t.delete }}
                  </NButton>
                </div>
                <div class="mer-bottom">
                  <div class="mer-num">
                    <span class="mini-label">{{ t.modelsCustomContextWindow }}</span>
                    <NInputNumber
                      v-model:value="m.contextWindow"
                      size="small"
                      :min="1024"
                      :step="1024"
                      :show-button="false"
                      :placeholder="t.modelsPickUnknown"
                    />
                  </div>
                  <div class="mer-num">
                    <span class="mini-label">{{ t.modelsCustomMaxTokens }}</span>
                    <NInputNumber
                      v-model:value="m.maxTokens"
                      size="small"
                      :min="256"
                      :step="1024"
                      :show-button="false"
                      :placeholder="String(DEFAULT_MAX_TOKENS)"
                    />
                  </div>
                  <div class="mer-caps">
                    <NTooltip trigger="hover" :delay="300">
                      <template #trigger>
                        <button
                          type="button"
                          class="cap-chip"
                          :class="{ on: m.reasoning, manual: isManual(i, 'reasoning') }"
                          @click="toggleCapability(i, 'reasoning')"
                        >
                          <NIcon :component="SparklesOutline" :size="11" />
                          {{ t.modelsCustomReasoning }}
                        </button>
                      </template>
                      {{ capTooltip(i, "reasoning") }}
                    </NTooltip>
                    <NTooltip trigger="hover" :delay="300">
                      <template #trigger>
                        <button
                          type="button"
                          class="cap-chip"
                          :class="{ on: m.vision, manual: isManual(i, 'vision') }"
                          @click="toggleCapability(i, 'vision')"
                        >
                          <NIcon :component="ImageOutline" :size="11" />
                          {{ t.modelsCustomVision }}
                        </button>
                      </template>
                      {{ capTooltip(i, "vision") }}
                    </NTooltip>
                    <NTooltip v-if="m.reasoning" trigger="hover" :delay="300">
                      <template #trigger>
                        <button
                          type="button"
                          class="cap-chip"
                          :class="{ on: m.thinkingXhigh !== false }"
                          @click="toggleExtendedThinking(i, 'thinkingXhigh')"
                        >
                          {{ t.modelsCustomThinkingXhigh }}
                        </button>
                      </template>
                      {{ t.modelsCustomThinkingXhighHint }}
                    </NTooltip>
                    <NTooltip v-if="m.reasoning" trigger="hover" :delay="300">
                      <template #trigger>
                        <button
                          type="button"
                          class="cap-chip"
                          :class="{ on: m.thinkingMax !== false }"
                          @click="toggleExtendedThinking(i, 'thinkingMax')"
                        >
                          {{ t.modelsCustomThinkingMax }}
                        </button>
                      </template>
                      {{ t.modelsCustomThinkingMaxHint }}
                    </NTooltip>
                  </div>
                </div>
              </div>
            </div>

            <NText depth="3" class="caps-note">
              {{ t.modelsCustomCapsHint }}
            </NText>
          </section>

          <NText
            v-if="formError"
            type="error"
            style="font-size: 12px; display: block; margin-top: 8px"
          >
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
          <header class="form-hero">
            <ProviderIcon :provider="selected.id" :size="40" />
            <div class="hero-text">
              <div class="hero-title">{{ selected.name || selected.id }}</div>
              <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
                {{ selected.id }} · {{ selected.api }}
              </NText>
            </div>
            <NSpace :size="6">
              <NButton
                size="small"
                secondary
                class="pi-interactive"
                :loading="testing"
                :disabled="testing || saving"
                @click="testConnection('selected')"
              >
                {{ testing ? t.modelsCustomTesting : t.modelsCustomTest }}
              </NButton>
              <NButton size="small" secondary class="pi-interactive" @click="beginEdit(selected.id)">
                {{ t.edit }}
              </NButton>
              <NButton
                size="small"
                secondary
                type="error"
                class="pi-interactive"
                :disabled="saving"
                @click="confirmDelete(selected.id)"
              >
                {{ t.delete }}
              </NButton>
            </NSpace>
          </header>

          <section class="form-section">
            <div class="field">
              <div class="field-label">{{ t.modelsCustomBaseUrl }}</div>
              <NText style="font-size: 12.5px; font-family: var(--font-mono); word-break: break-all">
                {{ selected.baseUrl || "—" }}
              </NText>
            </div>
          </section>

          <section class="form-section models-block">
            <div class="section-title">
              {{ t.modelsAvailable(selected.models.filter((m) => m.id).length) }}
            </div>
            <div
              v-for="m in selected.models.filter((x) => x.id)"
              :key="m.id"
              class="model-row"
            >
              <span class="model-name">{{ m.name || m.id }}</span>
              <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
                {{ m.id }}
              </NText>
              <NText depth="3" style="font-size: 11px">
                {{ m.contextWindow ? `ctx ${m.contextWindow}` : "ctx —" }} ·
                {{ m.maxTokens ? `out ${m.maxTokens}` : "out —" }}
                {{ m.reasoning ? " · reasoning" : "" }}{{ m.vision ? " · vision" : "" }}{{
                  m.thinkingXhigh !== false ? " · xhigh" : ""
                }}{{ m.thinkingMax !== false ? " · max" : "" }}
              </NText>
            </div>
          </section>
        </template>

        <div v-else class="empty-right">
          <NText depth="3">{{ t.modelsCustomSelectHint }}</NText>
          <NButton
            size="small"
            type="primary"
            secondary
            style="margin-top: 12px"
            class="pi-interactive"
            @click="beginAdd(null)"
          >
            {{ t.modelsCustomAddTitle }}
          </NButton>
        </div>
      </NScrollbar>
    </div>

    <ModelPickerModal
      :show="pickOpen"
      :provider-id="draft.id"
      :provider-label="draft.name || draft.id || t.modelsCustomProvider"
      :models="discovered"
      :loading="pickLoading"
      :error="pickError"
      mode="add"
      :existing-ids="draft.models.map((m) => m.id).filter(Boolean)"
      @close="pickOpen = false"
      @confirm="applyPickedModels"
    />

    <!-- 批量粘贴模型 ID -->
    <NModal
      v-model:show="bulkOpen"
      preset="card"
      :title="t.modelsCustomBulkTitle"
      class="bulk-modal pi-settings-modal"
      style="width: min(520px, 92vw)"
      :bordered="false"
      role="dialog"
      aria-modal="true"
    >
      <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
        {{ t.modelsCustomBulkHint }}
      </NText>
      <NInput
        v-model:value="bulkText"
        type="textarea"
        :autosize="{ minRows: 6, maxRows: 12 }"
        :placeholder="t.modelsCustomBulkPlaceholder"
        style="font-family: var(--font-mono); font-size: 12px"
      />
      <template #footer>
        <NSpace justify="end" align="center">
          <NButton size="small" class="pi-interactive" @click="bulkOpen = false">
            {{ t.cancel }}
          </NButton>
          <NButton
            size="small"
            type="primary"
            class="pi-interactive"
            :disabled="bulkParsed.length === 0"
            @click="applyBulkAdd"
          >
            {{ t.modelsCustomBulkApply(bulkParsed.length) }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.custom-layout {
  display: grid;
  grid-template-columns: 236px 1fr;
  gap: 0;
  flex: 1;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg);
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
  gap: 8px;
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
  gap: 9px;
  padding: 9px 12px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--fg);
  font: inherit;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.form-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.hero-text {
  min-width: 0;
  flex: 1;
}

.hero-title {
  font-size: 15px;
  font-weight: 660;
  color: var(--fg-strong);
  margin-bottom: 3px;
}

.form-section {
  margin-bottom: 14px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-panel) 66%, transparent);
}

.section-title {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--fg-strong);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.count-pill {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 20px;
  padding: 1px 7px;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
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
  flex-wrap: wrap;
}

/*
 * Model rows are two-line cards rather than one wide grid: the id and display
 * name get a full line each, so a long model id can no longer squeeze the
 * context / max-output inputs and the delete button out of view.
 */
.model-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-edit-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, var(--bg));
}

.model-edit-row:hover,
.model-edit-row:focus-within {
  border-color: var(--accent-border, var(--border-strong));
}

.mer-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mer-id {
  flex: 1.35 1 0;
  min-width: 0;
}

.mer-name {
  flex: 1 1 0;
  min-width: 0;
}

.mer-del {
  flex-shrink: 0;
}

.mer-bottom {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.mer-num {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.mer-num :deep(.n-input-number) {
  width: 118px;
}

.mini-label {
  font-size: 10.5px;
  color: var(--fg-faint);
  white-space: nowrap;
}

.mer-caps {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

/*
 * Capability chips are auto-detected; clicking one records a manual override.
 * `on` = supported, `manual` = the user set it explicitly.
 */
.cap-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 20px;
  border: 1px dashed var(--border-strong);
  background: transparent;
  color: var(--fg-faint);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.cap-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.cap-chip.on {
  border-style: solid;
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.cap-chip.manual {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
}

.caps-note {
  display: block;
  margin-top: 8px;
  font-size: 11px;
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
  display: grid;
  grid-template-columns: minmax(80px, 1fr) minmax(120px, 1.3fr) auto;
  gap: 12px;
  align-items: center;
  padding: 7px 2px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}

.model-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  min-height: 220px;
}

@media (max-width: 860px) {
  .field-grid {
    grid-template-columns: 1fr;
  }

  .mer-top {
    flex-wrap: wrap;
  }

  .mer-id,
  .mer-name {
    flex: 1 1 100%;
  }
}
</style>
