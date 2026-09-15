<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NInput,
  NModal,
  NScrollbar,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NText,
  NTag,
  NTooltip,
  useMessage,
} from "naive-ui";
import type {
  ModelsProviderAuth,
  ProviderCatalogModel,
  ProviderCatalogResult,
} from "../../../shared/models-settings";
import { buildProviderPlatforms, type ProviderPlatform } from "../../../shared/provider-catalog";
import {
  applyProviderModelOverrides,
  listEditableProviders,
  listProviderModelOverrides,
  parseModelsConfigText,
  stringifyModelsConfig,
  type ProviderModelOverride,
} from "../../../shared/custom-models";
import { DEFAULT_MAX_TOKENS } from "../../../shared/model-metadata";
import {
  filterAvailableModels,
  isProviderCurated,
  providerSelection,
  withProviderSelection,
  EMPTY_MODEL_SELECTION,
  type ModelSelection,
} from "../../../shared/model-selection";
import type { PickerRow } from "../../../shared/model-picker";
import ProviderIcon from "@renderer/components/ProviderIcon.vue";
import AddProviderModal from "@renderer/components/AddProviderModal.vue";
import ModelPickerModal from "@renderer/components/ModelPickerModal.vue";
import CustomModelsPanel from "@renderer/components/CustomModelsPanel.vue";
import { CloudDownloadOutline, ListOutline, RefreshOutline, TrashOutline } from "@vicons/ionicons5";
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
const modelSelection = ref<ModelSelection>({ providers: {} });
const loading = ref(false);
const saving = ref(false);
const selectedProvider = ref<string | null>(null);
const mainTab = ref<"auth" | "custom" | "json">("auth");
const platformOpen = ref(false);
const customStartAdd = ref(false);
const customStartPlatformId = ref<string | null>(null);
/** Pulling / refreshing the available-models list for the selected provider. */
const availableLoading = ref(false);
/** SDK catalog (with limits) per provider id. */
const catalogCache = ref<Record<string, ProviderCatalogResult>>({});

/** Picker state for the built-in provider flow. */
const pickOpen = ref(false);
const pickLoading = ref(false);
const pickError = ref<string | null>(null);
const pickModels = ref<ProviderCatalogModel[]>([]);
const pickProvider = ref<ModelsProviderAuth | null>(null);

const configuredProviders = computed(() => providers.value.filter((p) => p.configured));

const customProviderIds = computed(() => {
  try {
    return listEditableProviders(parseModelsConfigText(modelsText.value)).map((p) => p.id);
  } catch {
    return [] as string[];
  }
});

const platforms = computed<ProviderPlatform[]>(() =>
  buildProviderPlatforms({
    sdkProviders: providers.value,
    customProviderIds: customProviderIds.value,
  }),
);

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

const selectedMeta = computed(() =>
  providers.value.find((p) => p.id === selectedProvider.value) ?? null,
);

/** Every model the runtime currently exposes for the selected provider. */
const providerModels = computed(() => {
  if (!selectedProvider.value) return [];
  return available.value.filter((m) => m.provider === selectedProvider.value);
});

/** True when the user curated this provider (so we can offer "reset"). */
const providerCurated = computed(() =>
  selectedProvider.value ? isProviderCurated(modelSelection.value, selectedProvider.value) : false,
);

/** Curated ids for the selected provider, or null when uncurated. */
const curatedIds = computed(() => {
  if (!selectedProvider.value) return null;
  return providerSelection(modelSelection.value, selectedProvider.value);
});

/**
 * What the panel lists. Curated providers show exactly the curated models
 * (in curation order); uncurated ones show the whole catalog.
 */
const selectedModels = computed(() => {
  const all = providerModels.value;
  const ids = curatedIds.value;
  if (ids === null) return all;
  const byId = new Map(all.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is (typeof all)[number] => Boolean(m));
});

/** Models that exist upstream but the user filtered out. */
const hiddenModelCount = computed(() => providerModels.value.length - selectedModels.value.length);

/** Limits from the SDK catalog, keyed by model id. */
const catalogById = computed(() => {
  const id = selectedProvider.value;
  if (!id) return new Map<string, ProviderCatalogModel>();
  const entry = catalogCache.value[id];
  if (!entry) return new Map<string, ProviderCatalogModel>();
  return new Map(entry.models.map((m) => [m.id, m]));
});

/** Existing models.json pins for the selected provider. */
const overridesById = computed(() => {
  if (!selectedProvider.value) return new Map<string, Record<string, unknown>>();
  try {
    const doc = parseModelsConfigText(modelsText.value);
    return new Map(
      Object.entries(listProviderModelOverrides(doc, selectedProvider.value)),
    );
  } catch {
    return new Map<string, Record<string, unknown>>();
  }
});

function catalogLimits(modelId: string): { ctx?: number; max?: number } {
  const pinned = overridesById.value.get(modelId);
  const pinnedCtx = Number(pinned?.contextWindow);
  const pinnedMax = Number(pinned?.maxTokens);
  const base = catalogById.value.get(modelId);
  return {
    ctx: pinnedCtx > 0 ? pinnedCtx : base?.contextWindow || undefined,
    max: pinnedMax > 0 ? pinnedMax : base?.maxTokens || undefined,
  };
}

function isPinned(modelId: string): boolean {
  return overridesById.value.has(modelId);
}

async function loadProviderCatalog(providerId: string, force = false): Promise<void> {
  if (!force && catalogCache.value[providerId]) return;
  try {
    const result = await window.api.models.providerCatalog(providerId);
    catalogCache.value = { ...catalogCache.value, [providerId]: result };
  } catch {
    /* catalog is best-effort metadata for the list */
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await window.api.models.get();
    modelsText.value = data.modelsText;
    providers.value = data.providers ?? [];
    available.value = data.available;
    modelSelection.value = data.modelSelection ?? { ...EMPTY_MODEL_SELECTION, providers: {} };
    apiKeys.value = {};
    catalogCache.value = {};
    const configured = providers.value.filter((p) => p.configured);
    if (
      !selectedProvider.value ||
      !providers.value.some((p) => p.id === selectedProvider.value)
    ) {
      selectedProvider.value = configured[0]?.id ?? providers.value[0]?.id ?? null;
    }
    if (selectedProvider.value) void loadProviderCatalog(selectedProvider.value);
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
      platformOpen.value = false;
      pickOpen.value = false;
      void load();
    }
  },
);

watch(selectedProvider, (id) => {
  if (id) void loadProviderCatalog(id);
});

onMounted(() => {
  if (props.open) void load();
});

function openPlatformPicker(): void {
  platformOpen.value = true;
}

function pickPlatform(platform: ProviderPlatform): void {
  platformOpen.value = false;
  if (platform.kind === "sdk") {
    selectProvider(platform.providerId);
    mainTab.value = "auth";
    message.info(t.modelsPlatformKeyHint(platform.label), { duration: 6000 });
    return;
  }
  customStartPlatformId.value = platform.providerId;
  customStartAdd.value = true;
  mainTab.value = "custom";
}

function openDocs(url: string): void {
  void window.api.browser.openExternal(url);
}

function selectProvider(id: string): void {
  selectedProvider.value = id;
  platformOpen.value = false;
}

/** Re-pull the available-models list based on the current config (SDK catalog). */
async function refreshAvailable(): Promise<void> {
  if (availableLoading.value) return;
  availableLoading.value = true;
  try {
    const data = await window.api.models.get();
    modelsText.value = data.modelsText;
    providers.value = data.providers ?? [];
    available.value = data.available;
    if (selectedProvider.value) await loadProviderCatalog(selectedProvider.value, true);
    message.success(t.modelsAvailable(selectedModels.value.length));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    availableLoading.value = false;
  }
}

async function loadQuiet(): Promise<void> {
  try {
    const data = await window.api.models.get();
    modelsText.value = data.modelsText;
    providers.value = data.providers ?? [];
    available.value = data.available;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

async function save(opts?: { successMessage?: string; quietReload?: boolean }): Promise<void> {
  saving.value = true;
  try {
    const keysToWrite = Object.fromEntries(
      Object.entries(apiKeys.value).filter(([, v]) => Boolean(v?.trim())),
    );
    await window.api.models.set({
      modelsText: modelsText.value,
      apiKeys: keysToWrite,
    });
    message.success(opts?.successMessage ?? t.saved);
    emit("saved");
    window.dispatchEvent(new CustomEvent("pi-models-changed"));
    if (opts?.quietReload) await loadQuiet();
    else await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}

async function commitCustom(payload: {
  modelsText: string;
  apiKeys?: Record<string, string>;
  clearProviderKeys?: string[];
  successMessage?: string;
}): Promise<void> {
  modelsText.value = payload.modelsText;
  if (payload.apiKeys) {
    for (const [id, key] of Object.entries(payload.apiKeys)) {
      if (key?.trim()) apiKeys.value[id] = key.trim();
    }
  }
  if (payload.clearProviderKeys?.length) {
    for (const id of payload.clearProviderKeys) {
      try {
        await window.api.models.clearKey(id);
      } catch {
        /* still persist models.json removal */
      }
      delete apiKeys.value[id];
    }
  }
  await save({
    successMessage: payload.successMessage ?? t.saved,
    quietReload: true,
  });
}

async function deleteProvider(): Promise<void> {
  if (!selectedProvider.value) return;
  const id = selectedProvider.value;
  try {
    await window.api.models.clearKey(id);
    delete apiKeys.value[id];
    message.success(t.modelsProviderDeleted);
    await load();
    // Immediately move the left list selection to the nearest configured
    // provider (first one, else the provider just before / after the deleted one).
    const configured = providers.value.filter((p) => p.configured);
    if (configured.length) {
      const idx = configured.findIndex((p) => p.id === id);
      const next = configured[Math.max(0, idx - 1)] ?? configured[0];
      selectedProvider.value = next?.id ?? configured[0].id;
    } else {
      selectedProvider.value = providers.value[0]?.id ?? null;
    }
    window.dispatchEvent(new CustomEvent("pi-models-changed"));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Open the model picker for the selected provider.
 *
 * `mode: "select"` treats the picker as a curation list: nothing is written to
 * models.json unless the user also pinned limits, and the checked state mirrors
 * the existing curation (or everything, when the provider was never curated).
 */
async function openModelPicker(): Promise<void> {
  const meta = selectedMeta.value;
  if (!meta) return;
  pickProvider.value = meta;
  pickModels.value = [];
  pickError.value = null;
  pickLoading.value = true;
  pickOpen.value = true;
  try {
    const result = await window.api.models.providerCatalog(meta.id);
    catalogCache.value = { ...catalogCache.value, [meta.id]: result };
    if (!result.models.length) {
      pickError.value = t.modelsPickEmpty;
    } else {
      pickModels.value = result.models;
    }
  } catch (err) {
    pickError.value = err instanceof Error ? err.message : String(err);
  } finally {
    pickLoading.value = false;
  }
}

/** Ids currently shown for the provider — the picker's initial checked set. */
const pickInitialIds = computed(() => selectedModels.value.map((m) => m.id));

function persistSelection(next: ModelSelection): void {
  modelSelection.value = next;
  void window.api.models.setSelection(next).catch((err: unknown) => {
    message.error(err instanceof Error ? err.message : String(err));
  });
}

/** Reset the provider to "show the whole catalog". */
function resetSelection(): void {
  const id = selectedProvider.value;
  if (!id) return;
  persistSelection(withProviderSelection(modelSelection.value, id, null));
  message.success(t.modelsSelectResetDone);
}

/** Pin the currently listed models as the curation (drops hidden ones for good). */
function keepOnlyShown(): void {
  const id = selectedProvider.value;
  if (!id) return;
  persistSelection(
    withProviderSelection(
      modelSelection.value,
      id,
      selectedModels.value.map((m) => m.id),
    ),
  );
  message.success(t.modelsSelectKept(selectedModels.value.length));
}

async function applyPickedOverrides(rows: PickerRow[]): Promise<void> {
  const meta = pickProvider.value;
  if (!meta) return;
  try {
    /*
     * Only pin limits the user actually changed. The picker is also the
     * curation UI, so writing an override for every selected built-in model
     * would bloat models.json with hundreds of redundant entries that merely
     * restate the SDK catalog.
     */
    const catalog = catalogById.value;
    const overrides: Record<string, ProviderModelOverride> = {};
    for (const row of rows) {
      const base = catalog.get(row.id);
      const entry: ProviderModelOverride = {};
      const ctx = row.contextWindow && row.contextWindow > 0 ? Math.floor(row.contextWindow) : null;
      const max = row.maxTokens && row.maxTokens > 0 ? Math.floor(row.maxTokens) : null;
      if (ctx !== null && ctx !== base?.contextWindow) entry.contextWindow = ctx;
      if (max !== null && max !== base?.maxTokens) entry.maxTokens = max;
      if (row.reasoning && !base?.reasoning) entry.reasoning = true;
      if (Object.keys(entry).length) overrides[row.id] = entry;
    }

    if (Object.keys(overrides).length) {
      const doc = parseModelsConfigText(modelsText.value);
      modelsText.value = stringifyModelsConfig(
        applyProviderModelOverrides(doc, meta.id, overrides),
      );
    }

    // The picker doubles as the curation UI: whatever stays checked is what the
    // provider keeps showing (and what the composer's model menu offers).
    persistSelection(withProviderSelection(modelSelection.value, meta.id, rows.map((r) => r.id)));
    pickOpen.value = false;
    const pinned = Object.keys(overrides).length;
    if (pinned) {
      await save({
        successMessage: t.modelsPickOverridesApplied(rows.length, pinned),
        quietReload: true,
      });
    } else {
      await loadQuiet();
      message.success(t.modelsSelectConfirm(rows.length));
    }
  } catch (err) {
    message.error(
      `${t.modelsPickOverridesFail}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
</script>

<template>
  <NModal
    :show="open"
    preset="card"
    :title="t.modelsTitle"
    class="models-modal pi-settings-modal"
    style="width: min(1180px, 96vw)"
    :bordered="false"
    :mask-closable="!platformOpen && !pickOpen"
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
                  <NButton
                    size="tiny"
                    type="primary"
                    secondary
                    class="pi-interactive"
                    @click="openPlatformPicker"
                  >
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
                    <ProviderIcon :provider="p.id" :size="24" />
                    <div class="meta">
                      <div class="name">{{ p.displayName }}</div>
                      <NText depth="3" style="font-size: 11px">
                        {{ p.configured ? t.modelsConfigured : t.modelsPending }}
                        <template v-if="p.configured">
                          · {{ t.modelsAvailableCount(p.modelCount) }}
                        </template>
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
                      <ProviderIcon :provider="selectedMeta.id" :size="34" />
                      <div style="min-width: 0; flex: 1">
                        <div class="detail-title">{{ selectedMeta.displayName }}</div>
                        <NText depth="3" style="font-size: 11px; font-family: var(--font-mono)">
                          {{ selectedMeta.baseUrl || selectedMeta.id }}
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
                      <div class="models-head">
                        <div class="models-title">
                          <NText style="font-size: 12px; font-weight: 600">
                            {{ t.modelsAvailable(selectedModels.length) }}
                          </NText>
                          <NText v-if="hiddenModelCount > 0" depth="3" class="models-hidden">
                            {{ t.modelsHiddenCount(hiddenModelCount) }}
                          </NText>
                        </div>
                        <NSpace :size="6" align="center">
                          <NButton
                            size="small"
                            type="primary"
                            secondary
                            class="pi-interactive"
                            :disabled="availableLoading"
                            @click="openModelPicker"
                          >
                            <template #icon>
                              <NIcon :component="ListOutline" :size="14" />
                            </template>
                            {{ t.modelsSelectModels }}
                          </NButton>
                          <NButton
                            v-if="providerCurated"
                            size="small"
                            quaternary
                            class="pi-interactive"
                            @click="resetSelection"
                          >
                            {{ t.modelsSelectReset }}
                          </NButton>
                          <NTooltip trigger="hover">
                            <template #trigger>
                              <NButton
                                size="small"
                                quaternary
                                :loading="availableLoading"
                                :disabled="availableLoading"
                                @click="refreshAvailable"
                              >
                                <template #icon>
                                  <NIcon :component="RefreshOutline" :size="14" />
                                </template>
                              </NButton>
                            </template>
                            {{ t.modelsPullModels }}
                          </NTooltip>
                        </NSpace>
                      </div>
                      <div v-if="providerCurated && hiddenModelCount > 0" class="selection-note">
                        {{ t.modelsSelectHintOnly(selectedModels.length, providerModels.length) }}
                      </div>
                      <div v-if="!selectedModels.length" class="empty-models">
                        {{ providerCurated ? t.modelsSelectEmpty : t.modelsNone }}
                      </div>
                      <div
                        v-for="m in selectedModels"
                        :key="`${m.provider}/${m.id}`"
                        class="model-row"
                      >
                        <span class="model-name" :title="m.name">{{ m.name }}</span>
                        <NText depth="3" class="model-id" :title="m.id">{{ m.id }}</NText>
                        <span class="model-limits">
                          <span class="limit">{{ t.modelsPickStatsCtx(
                            catalogLimits(m.id).ctx ? String(catalogLimits(m.id).ctx) : "—"
                          ) }}</span>
                          <span class="limit">{{ t.modelsPickStatsMax(
                            catalogLimits(m.id).max ? String(catalogLimits(m.id).max) : "—"
                          ) }}</span>
                          <span v-if="isPinned(m.id)" class="limit pinned">
                            models.json
                          </span>
                        </span>
                      </div>
                      <div v-if="!providerCurated && selectedModels.length > 1" class="models-bulk">
                        <NButton size="tiny" quaternary class="pi-interactive" @click="keepOnlyShown">
                          {{ t.modelsSelectKeepShown }}
                        </NButton>
                      </div>
                      <NButton
                        v-if="selectedMeta.configured && selectedMeta.source === 'stored'"
                        size="small"
                        type="error"
                        secondary
                        class="provider-delete-btn"
                        @click="deleteProvider"
                      >
                        <template #icon>
                          <NIcon :component="TrashOutline" :size="14" />
                        </template>
                        {{ t.modelsDeleteProvider }}
                      </NButton>
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
              v-model:start-platform-id="customStartPlatformId"
              :saving="saving"
              @commit="commitCustom"
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

      <AddProviderModal
        :show="platformOpen"
        :platforms="platforms"
        @close="platformOpen = false"
        @pick="pickPlatform"
        @open-docs="openDocs"
      />

      <ModelPickerModal
        :show="pickOpen"
        :provider-id="pickProvider?.id ?? ''"
        :provider-label="pickProvider?.displayName ?? ''"
        :models="pickModels"
        :loading="pickLoading"
        :error="pickError"
        mode="override"
        :initial-selected-ids="pickInitialIds.length ? pickInitialIds : undefined"
        @close="pickOpen = false"
        @confirm="applyPickedOverrides"
      />
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton size="small" @click="emit('close')">{{ t.close }}</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="() => save()">{{
          t.save
        }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.modal-body {
  position: relative;
  height: min(680px, 78vh);
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
  grid-template-columns: 236px 1fr;
  gap: 0;
  flex: 1;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
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
  gap: 8px;
  padding: 9px 10px;
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
  padding: 8px 10px;
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
  border-left-color: var(--accent);
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

.detail-head {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 14px;
}

.detail-title {
  font-size: 15px;
  font-weight: 640;
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

.models-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.models-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.models-hidden {
  font-size: 11px;
  white-space: nowrap;
}

.selection-note {
  margin-bottom: 8px;
  padding: 6px 9px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--fg-muted);
  background: var(--accent-soft);
}

.models-bulk {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.provider-delete-btn {
  margin-top: 14px;
}

.model-row {
  display: grid;
  grid-template-columns: minmax(80px, 0.9fr) minmax(90px, 1.2fr) auto;
  gap: 12px;
  align-items: center;
  padding: 6px 2px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}

.model-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-id {
  font-size: 11px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-limits {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.limit {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--fg-faint);
  background: var(--bg-hover);
  border-radius: 20px;
  padding: 1px 6px;
}

.limit.pinned {
  color: var(--accent);
  background: var(--accent-soft);
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
  min-height: 220px;
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
  min-height: 380px;
}

@media (max-width: 860px) {
  .model-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
