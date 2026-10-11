<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { NIcon, NPopover, NSpin } from "naive-ui";
import { CheckmarkOutline, SearchOutline, SettingsOutline } from "@vicons/ionicons5";
import { t } from "@renderer/i18n";

export type ChoiceOption = { value: string; label?: string; color?: string };

const props = withDefaults(
  defineProps<{
    title: string;
    options: ChoiceOption[];
    selected: string[];
    multi?: boolean;
    loading?: boolean;
    error?: string | null;
  }>(),
  { multi: false, loading: false, error: null },
);

const emit = defineEmits<{
  (event: "load"): void;
  (event: "toggle", value: string, on: boolean): void;
}>();

const open = ref(false);
const query = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

const visible = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return props.options;
  return props.options.filter((option) => (option.label ?? option.value).toLowerCase().includes(text));
});

function onShow(show: boolean): void {
  open.value = show;
  if (!show) return;
  query.value = "";
  emit("load");
  void nextTick(() => inputRef.value?.focus());
}

function toggle(option: ChoiceOption, next: boolean): void {
  emit("toggle", option.value, next);
}
</script>

<template>
  <NPopover
    trigger="click"
    placement="bottom-end"
    :show-arrow="false"
    :content-style="{ padding: '0', width: '256px' }"
    @update:show="onShow"
  >
    <template #trigger>
      <button
        type="button"
        class="choice-trigger"
        :aria-label="t.prEditField(title)"
        :aria-expanded="open"
      >
        <NIcon :component="SettingsOutline" :size="14" />
      </button>
    </template>

    <div class="choice-panel">
      <div class="choice-search">
        <NIcon :component="SearchOutline" :size="14" class="search-icon" />
        <input
          ref="inputRef"
          :value="query"
          type="search"
          :placeholder="t.prFilterField(title)"
          :aria-label="t.prFilterField(title)"
          @input="(event: Event) => (query = (event.target as HTMLInputElement).value)"
          @keydown.stop
        />
      </div>
      <div class="choice-list">
        <p v-if="error" class="choice-error">{{ error }}</p>
        <div v-else-if="loading && options.length === 0" class="choice-loading"><NSpin size="small" /></div>
        <p v-else-if="visible.length === 0" class="choice-empty">{{ t.prNoChoiceMatches(query.trim()) }}</p>
        <button
          v-for="option in visible"
          v-else
          :key="option.value"
          type="button"
          class="choice-option"
          :aria-pressed="selected.includes(option.value)"
          @click="toggle(option, !selected.includes(option.value))"
        >
          <span
            class="choice-dot"
            :class="{ hidden: !option.color }"
            :style="option.color ? { background: `#${option.color}` } : undefined"
          />
          <span class="choice-label">{{ option.label ?? option.value }}</span>
          <NIcon
            :component="CheckmarkOutline"
            :size="14"
            class="choice-check"
            :class="{ on: selected.includes(option.value) }"
          />
        </button>
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.choice-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-right: -5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.choice-trigger:hover {
  background: rgba(127, 127, 127, 0.08);
  color: var(--fg);
}

.choice-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.choice-search {
  position: relative;
  display: flex;
  align-items: center;
  padding: 8px;
}

.search-icon {
  position: absolute;
  left: 18px;
  color: var(--fg-muted);
  pointer-events: none;
}

.choice-search input {
  width: 100%;
  height: 32px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  padding: 0 8px 0 30px;
  font-size: 12px;
  outline: none;
}

.choice-list {
  max-height: 288px;
  overflow-y: auto;
  border-top: 1px solid var(--border);
  padding: 4px;
}

.choice-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.choice-option:hover {
  background: rgba(127, 127, 127, 0.08);
}

.choice-dot {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(127, 127, 127, 0.3);
}

.choice-dot.hidden {
  visibility: hidden;
}

.choice-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-check {
  flex: none;
  color: var(--accent);
  opacity: 0;
}

.choice-check.on {
  opacity: 1;
}

.choice-error,
.choice-empty {
  margin: 0;
  padding: 8px;
  font-size: 12px;
  color: var(--fg-muted);
}

.choice-error {
  color: var(--error);
}

.choice-loading {
  display: flex;
  justify-content: center;
  padding: 8px;
}
</style>
