<script setup lang="ts">
/**
 * Model picker used for two flows:
 *  - "fetch models from provider" for a custom provider (`mode: "add"`)
 *  - choosing which of a provider's models stay visible (`mode: "select"` /
 *    `mode: "override"`)
 *
 * Every row starts checked unless `initialSelectedIds` narrows it, the selection
 * can be inverted wholesale (select all / none), cleared outright, and every row
 * carries an editable context window + max-output budget. A model that reports no
 * budget gets the GUI default (32K).
 */
import { computed, ref, watch } from "vue";
import { NButton, NCheckbox, NInput, NInputNumber, NScrollbar, NSpin, NText } from "naive-ui";
import { DEFAULT_MAX_TOKENS } from "../../../shared/model-metadata";
import type { PickerModel, PickerRow } from "../../../shared/model-picker";
import ProviderIcon from "@renderer/components/ProviderIcon.vue";
import { t } from "@renderer/i18n";

const props = withDefaults(
  defineProps<{
    show: boolean;
    /** Platform id used for the brand badge. */
    providerId: string;
    providerLabel: string;
    models: PickerModel[];
    loading?: boolean;
    error?: string | null;
    /**
     * `add`      — merge the picked models into a custom provider draft.
     * `select`   — pick which of a provider's models stay visible (curation).
     * `override` — same as `select`, and pin limits into models.json.
     */
    mode?: "add" | "select" | "override";
    /** Model ids already present in the draft (pre-marked as existing). */
    existingIds?: string[];
    /**
     * Ids to pre-check. Omitted → every row starts checked. Provided → only the
     * listed ids start checked, so re-opening the picker for an already curated
     * provider shows the current selection instead of resetting it.
     */
    initialSelectedIds?: string[];
  }>(),
  {
    loading: false,
    error: null,
    mode: "add",
    existingIds: () => [],
    initialSelectedIds: undefined,
  },
);

const emit = defineEmits<{
  close: [];
  confirm: [rows: PickerRow[]];
}>();

const rows = ref<PickerRow[]>([]);
const query = ref("");

/** Ids already configured, snapshotted when the modal opens. */
const existing = ref(new Set<string>());

function buildRows(models: PickerModel[]): PickerRow[] {
  const known = new Set(props.existingIds ?? []);
  const prechecked = props.initialSelectedIds ? new Set(props.initialSelectedIds) : null;
  existing.value = known;
  return models.map((m) => ({
    id: m.id,
    name: m.name && m.name !== m.id ? m.name : "",
    contextWindow: m.contextWindow && m.contextWindow > 0 ? Math.floor(m.contextWindow) : null,
    maxTokens:
      m.maxTokens && m.maxTokens > 0 ? Math.floor(m.maxTokens) : DEFAULT_MAX_TOKENS,
    reasoning: Boolean(m.reasoning),
    vision: Boolean(m.vision),
    selected: prechecked ? prechecked.has(m.id) : true,
  }));
}

watch(
  () => [props.show, props.models] as const,
  ([open]) => {
    if (!open) return;
    rows.value = buildRows(props.models);
    query.value = "";
  },
  { immediate: true },
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter(
    (r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
  );
});

const selectedCount = computed(() => rows.value.filter((r) => r.selected).length);
const allSelected = computed(() => rows.value.length > 0 && selectedCount.value === rows.value.length);

function toggleAll(): void {
  const next = !allSelected.value;
  for (const row of rows.value) row.selected = next;
}

function selectAll(): void {
  for (const row of rows.value) row.selected = true;
}

function selectNone(): void {
  for (const row of rows.value) row.selected = false;
}

/**
 * Row click toggles selection. Naive UI's `NCheckbox` is a `div[role=checkbox]`
 * without a native input, so a `<label>` wrapper would not work — the row owns
 * the interaction and clicks inside the limit editors are ignored.
 */
function toggleRow(row: PickerRow, event?: MouseEvent): void {
  if (event) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, button, .n-input, .n-input-number")) return;
  }
  row.selected = !row.selected;
}

const defaultedMaxCount = computed(
  () => rows.value.filter((r) => r.maxTokens === DEFAULT_MAX_TOKENS).length,
);

/** "Add" needs at least one row; curation modes legitimately allow zero (= hide all). */
const isCuration = computed(() => props.mode !== "add");

function confirm(): void {
  const picked = rows.value.filter((r) => r.selected && r.id.trim());
  if (!picked.length && !isCuration.value) {
    emit("close");
    return;
  }
  emit("confirm", picked);
}

function formatTokens(value: number | null): string {
  if (!value) return t.modelsPickUnknown;
  return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="pi-fade">
      <div
        v-if="show"
        class="picker-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t.modelsPickTitle(providerLabel)"
        @click.self="emit('close')"
        @keydown.esc="emit('close')"
      >
        <div class="picker-panel">
          <header class="picker-head">
            <ProviderIcon :provider="providerId" :size="34" />
            <div class="head-text">
              <h2 class="picker-title">{{ t.modelsPickTitle(providerLabel) }}</h2>
              <p class="picker-sub">
                <template v-if="loading">{{ t.modelsPickLoading }}</template>
                <template v-else-if="error">{{ error }}</template>
                <template v-else>{{ t.modelsPickSubtitle(rows.length) }}</template>
              </p>
            </div>
            <NButton size="small" quaternary class="pi-interactive" @click="emit('close')">
              {{ t.close }}
            </NButton>
          </header>

          <div class="picker-toolbar">
            <NInput
              v-model:value="query"
              size="small"
              clearable
              class="search"
              :placeholder="t.modelsPickSearch"
              :disabled="loading || rows.length === 0"
            />
            <NCheckbox
              :checked="allSelected"
              :disabled="loading || rows.length === 0"
              :indeterminate="selectedCount > 0 && !allSelected"
              class="select-all"
              @update:checked="toggleAll"
            >
              {{ t.modelsPickSelectAll }}
            </NCheckbox>
            <NButton
              size="tiny"
              quaternary
              class="pi-interactive"
              :disabled="loading || rows.length === 0"
              @click="selectNone"
            >
              {{ t.modelsPickSelectNone }}
            </NButton>
            <div class="toolbar-spacer" />
            <NText depth="3" style="font-size: 11.5px">
              {{ t.modelsPickSelected(selectedCount, rows.length) }}
            </NText>
          </div>

          <div class="picker-cols">
            <span class="col-model">{{ t.modelsPickColModel }}</span>
            <span class="col-num">{{ t.modelsPickColContext }}</span>
            <span class="col-num">{{ t.modelsPickColMaxTokens }}</span>
          </div>

          <NScrollbar class="picker-scroll">
            <NSpin v-if="loading" :show="true" class="picker-spin" />
            <template v-else>
              <div
                v-for="row in filtered"
                :key="row.id"
                class="model-row"
                :class="{ picked: row.selected, existing: existing.has(row.id) }"
                role="checkbox"
                tabindex="0"
                :aria-checked="row.selected"
                @click="toggleRow(row, $event)"
                @keydown.space.prevent="toggleRow(row)"
                @keydown.enter.prevent="toggleRow(row)"
              >
                <NCheckbox :checked="row.selected" class="row-check" tabindex="-1" />
                <span class="col-model">
                  <span class="model-id">{{ row.id }}</span>
                  <span class="model-meta">
                    <span v-if="row.name" class="model-name">{{ row.name }}</span>
                    <span v-if="existing.has(row.id)" class="chip chip-existing">{{
                      t.modelsPlatformConfigured
                    }}</span>
                    <span v-if="row.reasoning" class="chip">reasoning</span>
                    <span v-if="row.vision" class="chip">vision</span>
                  </span>
                </span>
                <NInputNumber
                  v-model:value="row.contextWindow"
                  size="small"
                  class="col-num"
                  :min="1024"
                  :step="1024"
                  :show-button="false"
                  :placeholder="t.modelsPickUnknown"
                  :title="t.modelsPickStatsCtx(formatTokens(row.contextWindow))"
                />
                <NInputNumber
                  v-model:value="row.maxTokens"
                  size="small"
                  class="col-num"
                  :min="256"
                  :step="1024"
                  :show-button="false"
                  :placeholder="String(DEFAULT_MAX_TOKENS)"
                  :title="t.modelsPickStatsMax(formatTokens(row.maxTokens))"
                />
              </div>
              <div v-if="!filtered.length && rows.length" class="picker-empty">
                {{ t.modelsPickEmpty }}
              </div>
              <div v-if="!rows.length && !error" class="picker-empty">
                {{ t.modelsPickNeedKey }}
              </div>
            </template>
          </NScrollbar>

          <footer class="picker-foot">
            <div class="foot-hint">
              <span>{{
                mode === "override"
                  ? t.modelsPickOverrideHint
                  : isCuration
                    ? t.modelsPickSelectHint
                    : t.modelsPickDiscoveredHint
              }}</span>
              <span v-if="isCuration && selectedCount === 0" class="foot-danger">
                {{ t.modelsPickClearWarn }}
              </span>
              <span v-else-if="defaultedMaxCount > 0" class="foot-default">
                {{ t.modelsPickDefaultMaxHint }}
              </span>
            </div>
            <div class="foot-actions">
              <NButton size="small" class="pi-interactive" @click="emit('close')">
                {{ t.cancel }}
              </NButton>
              <NButton
                size="small"
                :type="isCuration && selectedCount === 0 ? 'error' : 'primary'"
                :secondary="isCuration && selectedCount === 0"
                class="pi-interactive"
                :disabled="!isCuration && selectedCount === 0"
                @click="confirm"
              >
                {{
                  selectedCount === 0 && isCuration
                    ? t.modelsPickClearAll
                    : mode === "override"
                      ? t.modelsPickApplyConfirm(selectedCount)
                      : mode === "select"
                        ? t.modelsSelectConfirm(selectedCount)
                        : t.modelsPickConfirm(selectedCount)
                }}
              </NButton>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 4300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(9, 9, 11, 0.48);
  backdrop-filter: blur(3px);
}

.picker-panel {
  width: min(840px, 94vw);
  height: min(640px, 84vh);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg));
  box-shadow: var(--shadow-lg, 0 24px 70px rgba(0, 0, 0, 0.32));
  overflow: hidden;
}

.picker-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-panel) 78%, transparent),
    transparent
  );
}

.head-text {
  min-width: 0;
  flex: 1;
}

.picker-title {
  margin: 0;
  font-size: 15.5px;
  font-weight: 680;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-sub {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 20px;
  border-bottom: 1px solid var(--border);
}

.search {
  width: 220px;
  flex-shrink: 0;
}

.select-all {
  flex-shrink: 0;
}

.toolbar-spacer {
  flex: 1;
}

.picker-cols,
.model-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 116px 116px;
  gap: 10px;
  align-items: center;
}

.picker-cols {
  padding: 7px 20px 6px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--fg-faint);
  border-bottom: 1px solid var(--border);
}

.picker-scroll {
  flex: 1;
  min-height: 160px;
}

.picker-spin {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}

.model-row {
  padding: 6px 20px;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  outline: none;
}

.model-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--accent-border, var(--accent));
}

.model-row:hover {
  background: var(--bg-hover);
}

.model-row.picked {
  background: color-mix(in srgb, var(--accent-soft) 60%, transparent);
}

.model-row.existing .model-id {
  color: var(--fg-muted);
}

.row-check {
  pointer-events: none;
}

.col-model {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.model-name {
  font-size: 11px;
  color: var(--fg-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip {
  flex-shrink: 0;
  font-size: 10px;
  padding: 0 6px;
  border-radius: 20px;
  color: var(--fg-faint);
  background: var(--bg-hover);
}

.chip-existing {
  color: var(--accent);
  background: var(--accent-soft);
}

.col-num {
  width: 100%;
}

.picker-empty {
  padding: 44px 20px;
  text-align: center;
  font-size: 12.5px;
  color: var(--fg-faint);
}

.picker-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px 14px;
  border-top: 1px solid var(--border);
}

.foot-hint {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--fg-faint);
}

.foot-default {
  color: var(--fg-muted);
}

.foot-danger {
  color: var(--red, #ef4444);
}

.foot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pi-fade-enter-active,
.pi-fade-leave-active {
  transition: opacity 120ms var(--ease-out, ease);
}

.pi-fade-enter-from,
.pi-fade-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .picker-cols,
  .model-row {
    grid-template-columns: 18px minmax(0, 1fr) 92px 92px;
  }

  .search {
    width: 150px;
  }
}
</style>
