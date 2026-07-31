<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { atFileDirLabel, type AtFileItem } from "../../../shared/at-file-mention";
import { t } from "@renderer/i18n";

const props = defineProps<{
  items: AtFileItem[];
  visible: boolean;
  emptyHint?: string;
}>();

const emit = defineEmits<{
  select: [item: AtFileItem];
}>();

const activeIndex = ref(0);
const listRef = ref<HTMLElement | null>(null);

watch(
  () => [props.visible, props.items.map((i) => i.path).join("|")] as const,
  () => {
    activeIndex.value = 0;
  },
);

const safeIndex = computed(() => {
  if (!props.items.length) return 0;
  return Math.min(activeIndex.value, props.items.length - 1);
});

function scrollActiveIntoView(): void {
  void nextTick(() => {
    const root = listRef.value;
    if (!root) return;
    const row = root.querySelector<HTMLElement>(`.at-row[data-index="${safeIndex.value}"]`);
    row?.scrollIntoView({ block: "nearest" });
  });
}

watch(safeIndex, () => {
  if (props.visible) scrollActiveIntoView();
});

function move(delta: number): void {
  if (!props.items.length) return;
  const n = props.items.length;
  activeIndex.value = (safeIndex.value + delta + n) % n;
}

function confirm(): boolean {
  const item = props.items[safeIndex.value];
  if (!item) return false;
  emit("select", item);
  return true;
}

function dirOf(item: AtFileItem): string {
  return atFileDirLabel(item.path);
}

defineExpose({
  move,
  confirm,
  get activeIndex() {
    return safeIndex.value;
  },
});
</script>

<template>
  <div
    v-if="visible"
    ref="listRef"
    class="at-menu"
    role="listbox"
    :aria-label="t.atFileMenuLabel"
  >
    <div v-if="!items.length" class="at-empty">
      {{ emptyHint || t.atFileEmpty }}
    </div>
    <button
      v-for="(item, index) in items"
      :key="item.path"
      type="button"
      class="at-row"
      role="option"
      :data-index="index"
      :aria-selected="index === safeIndex"
      :class="{ active: index === safeIndex }"
      :title="item.path"
      @mousedown.prevent="emit('select', item)"
      @mouseenter="activeIndex = index"
    >
      <span class="icon" :class="item.kind" aria-hidden="true" />
      <span class="name">{{ item.name }}</span>
      <span class="dir">{{ dirOf(item) }}</span>
    </button>
  </div>
</template>

<style scoped>
.at-menu {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: calc(100% + 6px);
  z-index: 20;
  max-height: min(360px, 42vh);
  overflow: auto;
  border: 1px solid var(--border, #ddd);
  border-radius: 10px;
  background: var(--bg-elevated, #fff);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
  padding: 4px;
}

.at-empty {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--fg-muted, #888);
}

.at-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 8px;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.at-row:hover,
.at-row.active {
  background: color-mix(in srgb, var(--primary, #3b82f6) 12%, transparent);
}

.icon {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  border: 1.5px solid color-mix(in srgb, var(--fg-muted, #888) 55%, transparent);
  box-sizing: border-box;
  justify-self: center;
}

.icon.dir {
  border-radius: 2px 2px 1px 1px;
  border-top-width: 3px;
  background: color-mix(in srgb, var(--fg-muted, #888) 8%, transparent);
}

.icon.file {
  background: color-mix(in srgb, var(--fg-muted, #888) 5%, transparent);
}

.name {
  font-size: 12.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-strong, #222);
}

.dir {
  font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 11px;
  color: var(--fg-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  direction: rtl;
}
</style>
