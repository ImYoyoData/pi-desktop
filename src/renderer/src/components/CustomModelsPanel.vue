<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NInput,
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
  parseModelsConfigText,
  removeCustomProvider,
  renameCustomProvider,
  stringifyModelsConfig,
  upsertCustomProvider,
  validateCustomProvider,
  type CustomModelEntry,
  type CustomProviderDraft,
} from "../../../shared/custom-models";
import { t } from "@renderer/i18n";

const props = defineProps<{
  modelsText: string;
  /** When true, start a blank “add provider” form. */
  startAdd?: boolean;
}>();

const emit = defineEmits<{
  "update:modelsText": [string];
  "update:startAdd": [boolean];
}>();

const message = useMessage();
const dialog = useDialog();

const selectedId = ref<string | null>(null);
const editing = ref(false);
const isNew = ref(false);
const draft = ref<CustomProviderDraft>(emptyCustomProvider());
const formError = ref<string | null>(null);

const apiOptions = CUSTOM_MODEL_APIS.map((api) => ({ label: api, value: api }));

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

function beginAdd(): void {
  isNew.value = true;
  editing.value = true;
  formError.value = null;
  selectedId.value = null;
  draft.value = emptyCustomProvider({
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    models: [{ id: "llama3.1:8b", name: "", reasoning: false }],
  });
  emit("update:startAdd", false);
}

function beginEdit(id: string): void {
  const row = docProviders.value.find((p) => p.id === id);
  if (!row) return;
  selectedId.value = id;
  isNew.value = false;
  editing.value = true;
  formError.value = null;
  draft.value = {
    ...row,
    models: row.models.map((m) => ({ ...m })),
  };
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
}

function removeModelRow(index: number): void {
  if (draft.value.models.length <= 1) {
    draft.value.models = [{ id: "", name: "", reasoning: false }];
    return;
  }
  draft.value.models.splice(index, 1);
}

function applyDraft(): void {
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
  const next = isNew.value
    ? upsertCustomProvider(doc, draft.value)
    : renameCustomProvider(doc, selectedId.value || draft.value.id, draft.value);
  emit("update:modelsText", stringifyModelsConfig(next));
  selectedId.value = draft.value.id.trim();
  editing.value = false;
  isNew.value = false;
  message.success(t.modelsCustomApplied);
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
        emit("update:modelsText", stringifyModelsConfig(next));
        if (selectedId.value === id) selectedId.value = null;
        if (editing.value && draft.value.id === id) cancelEdit();
        message.success(t.modelsCustomDeleted);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

function modelPlaceholder(m: CustomModelEntry, i: number): string {
  return i === 0 ? "llama3.1:8b" : t.modelsCustomModelId;
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
          @click="selectedId = p.id; editing = false"
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

          <div class="field">
            <div class="field-label">{{ t.modelsCustomProviderId }}</div>
            <NInput
              v-model:value="draft.id"
              size="small"
              :disabled="!isNew"
              placeholder="ollama"
            />
          </div>
          <div class="field">
            <div class="field-label">{{ t.modelsCustomDisplayName }}</div>
            <NInput v-model:value="draft.name" size="small" placeholder="Ollama" />
          </div>
          <div class="field">
            <div class="field-label">{{ t.modelsCustomBaseUrl }}</div>
            <NInput
              v-model:value="draft.baseUrl"
              size="small"
              placeholder="http://localhost:11434/v1"
            />
          </div>
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

          <div class="models-editor">
            <div class="models-editor-head">
              <NText style="font-size: 12px; font-weight: 600">{{ t.modelsCustomModels }}</NText>
              <NButton size="tiny" quaternary class="pi-interactive" @click="addModelRow">
                {{ t.modelsCustomAddModel }}
              </NButton>
            </div>
            <div v-for="(m, i) in draft.models" :key="i" class="model-edit-row">
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
              <div class="m-reason">
                <NText depth="3" style="font-size: 11px">{{ t.modelsCustomReasoning }}</NText>
                <NSwitch v-model:value="m.reasoning" size="small" />
              </div>
              <NButton size="tiny" quaternary type="error" @click="removeModelRow(i)">
                {{ t.delete }}
              </NButton>
            </div>
          </div>

          <NText v-if="formError" type="error" style="font-size: 12px; display: block; margin-top: 8px">
            {{ formError }}
          </NText>

          <NSpace justify="end" style="margin-top: 14px">
            <NButton size="small" class="pi-interactive" @click="cancelEdit">{{ t.cancel }}</NButton>
            <NButton size="small" type="primary" class="pi-interactive" @click="applyDraft">
              {{ t.modelsCustomApply }}
            </NButton>
          </NSpace>
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
              <NButton size="tiny" secondary class="pi-interactive" @click="beginEdit(selected.id)">
                {{ t.edit }}
              </NButton>
              <NButton
                size="tiny"
                secondary
                type="error"
                class="pi-interactive"
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
                {{ m.id }}{{ m.reasoning ? " · reasoning" : "" }}
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

.form-head {
  margin-bottom: 14px;
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
  margin: 4px 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
}

.compat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.models-editor {
  margin-top: 4px;
}

.models-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.model-edit-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr auto auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.m-reason {
  display: flex;
  align-items: center;
  gap: 6px;
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
</style>
