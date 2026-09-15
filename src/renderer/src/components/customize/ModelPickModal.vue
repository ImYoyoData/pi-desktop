<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NCheckbox, NInput, NModal, NSpace } from "naive-ui";
import type { DiscoveredModel } from "../../../../shared/model-discover";
import { t } from "@renderer/i18n";

const props = defineProps<{
  show: boolean;
  models: DiscoveredModel[];
  /** Model ids already present in the provider draft. */
  existingIds: string[];
}>();

const emit = defineEmits<{
  close: [];
  confirm: [models: DiscoveredModel[]];
}>();

const query = ref("");
const selected = ref<Set<string>>(new Set());

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    query.value = "";
    selected.value = new Set();
  },
);

const existing = computed(() => new Set(props.existingIds));

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.models;
  return props.models.filter(
    (model) =>
      model.id.toLowerCase().includes(q) || (model.name ?? "").toLowerCase().includes(q),
  );
});

const selectableVisible = computed(() =>
  filtered.value.filter((model) => !existing.value.has(model.id)),
);

const allVisibleSelected = computed(
  () =>
    selectableVisible.value.length > 0 &&
    selectableVisible.value.every((model) => selected.value.has(model.id)),
);

function describeModel(model: DiscoveredModel): string {
  const parts: string[] = [];
  if (model.name && model.name !== model.id) parts.push(model.name);
  if (model.contextWindow) {
    parts.push(`${t.modelsCustomContextWindow} ${model.contextWindow.toLocaleString()}`);
  }
  if (model.maxTokens) {
    parts.push(`${t.modelsCustomMaxTokens} ${model.maxTokens.toLocaleString()}`);
  }
  return parts.join(" · ");
}

/** 行数据：把自动获取到的能力信息一并展示出来。 */
const displayRows = computed(() =>
  filtered.value.map((model) => ({
    id: model.id,
    meta: describeModel(model),
    reasoning: model.reasoning === true,
    vision: model.vision === true,
    existing: existing.value.has(model.id),
  })),
);

function toggle(id: string): void {
  if (existing.value.has(id)) return;
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleAllVisible(): void {
  const next = new Set(selected.value);
  if (allVisibleSelected.value) {
    for (const model of selectableVisible.value) next.delete(model.id);
  } else {
    for (const model of selectableVisible.value) next.add(model.id);
  }
  selected.value = next;
}

function confirmPick(): void {
  const picked = props.models.filter((model) => selected.value.has(model.id));
  if (!picked.length) return;
  emit("confirm", picked);
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="pi-settings-modal model-pick-modal"
    style="width: min(560px, 92vw)"
    :bordered="false"
    :mask-closable="false"
    @close="emit('close')"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <template #header>
      <div class="modal-title-block">
        <div class="modal-title">{{ t.modelsCustomPickTitle }}</div>
        <div class="modal-subtitle">{{ t.modelsCustomPickSubtitle }}</div>
      </div>
    </template>

    <div class="pick-toolbar">
      <NInput
        v-model:value="query"
        size="small"
        clearable
        :placeholder="t.modelsCustomPickSearch"
      />
      <NButton size="small" secondary :disabled="!selectableVisible.length" @click="toggleAllVisible">
        {{ allVisibleSelected ? t.modelsCustomPickClear : t.modelsCustomPickSelectAll }}
      </NButton>
    </div>

    <div class="pick-list">
      <p v-if="!displayRows.length" class="pick-empty">{{ t.modelsCustomPickEmpty }}</p>
      <label
        v-for="row in displayRows"
        :key="row.id"
        class="pick-row"
        :class="{ existing: row.existing }"
      >
        <NCheckbox
          class="pick-check"
          :checked="selected.has(row.id)"
          :disabled="row.existing"
          @update:checked="toggle(row.id)"
        />
        <span class="pick-main">
          <span class="pick-head">
            <span class="pick-id">{{ row.id }}</span>
            <span v-if="row.reasoning" class="pick-tag">{{ t.modelsCustomReasoning }}</span>
            <span v-if="row.vision" class="pick-tag">{{ t.modelsCustomVision }}</span>
          </span>
          <span v-if="row.meta" class="pick-sub">{{ row.meta }}</span>
        </span>
        <span v-if="row.existing" class="pick-badge">
          {{ t.modelsCustomPickExisting }}
        </span>
      </label>
    </div>

    <template #footer>
      <div class="pick-footer">
        <span class="pick-count">{{ t.modelsCustomPickSelected(selected.size) }}</span>
        <NSpace justify="end">
          <NButton type="primary" size="small" :disabled="!selected.size" @click="confirmPick">
            {{ t.modelsCustomPickAdd }}
          </NButton>
          <NButton size="small" @click="emit('close')">{{ t.cancel }}</NButton>
        </NSpace>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.modal-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  color: var(--fg-strong);
  font-size: 15px;
  font-weight: 650;
}

.modal-subtitle {
  color: var(--fg-muted);
  font-size: 12px;
}

.pick-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.pick-toolbar > :first-child {
  flex: 1;
  min-width: 0;
}

.pick-list {
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.pick-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
}

.pick-row:hover {
  background: var(--bg-hover);
}

.pick-row.existing {
  cursor: default;
  opacity: 0.55;
}

.pick-check {
  margin-top: 1px;
}

.pick-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.pick-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pick-id {
  overflow: hidden;
  color: var(--fg);
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-tag {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--bg-active);
  color: var(--fg-muted);
  font-size: 10px;
  line-height: 15px;
}

.pick-sub {
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-badge {
  flex-shrink: 0;
  margin-top: 1px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--bg-active);
  color: var(--fg-muted);
  font-size: 10px;
  line-height: 16px;
}

.pick-empty {
  margin: 0;
  padding: 24px 0;
  color: var(--fg-muted);
  font-size: 12px;
  text-align: center;
}

.pick-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pick-count {
  flex: 1;
  color: var(--fg-muted);
  font-size: 12px;
}
</style>
