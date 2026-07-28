<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SlashItem } from "../../../shared/slash-commands";

const props = defineProps<{
  items: SlashItem[];
  visible: boolean;
}>();

const emit = defineEmits<{
  select: [item: SlashItem];
  dismiss: [];
}>();

const activeIndex = ref(0);

watch(
  () => [props.visible, props.items.map((i) => i.id).join("|")] as const,
  () => {
    activeIndex.value = 0;
  },
);

const safeIndex = computed(() => {
  if (!props.items.length) return 0;
  return Math.min(activeIndex.value, props.items.length - 1);
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

defineExpose({
  move,
  confirm,
  get activeIndex() {
    return safeIndex.value;
  },
});
</script>

<template>
  <div v-if="visible && items.length" class="slash-menu" role="listbox">
    <button
      v-for="(item, index) in items"
      :key="item.id"
      type="button"
      class="slash-row"
      role="option"
      :aria-selected="index === safeIndex"
      :class="{ active: index === safeIndex, skill: item.kind === 'skill' }"
      @mousedown.prevent="emit('select', item)"
      @mouseenter="activeIndex = index"
    >
      <span class="cmd">/{{ item.command }}</span>
      <span class="desc">{{ item.description }}</span>
      <span class="kind">{{ item.kind === "skill" ? "skill" : "cmd" }}</span>
    </button>
  </div>
</template>

<style scoped>
.slash-menu {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: calc(100% + 6px);
  z-index: 20;
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--border, #ddd);
  border-radius: 10px;
  background: var(--bg-elevated, #fff);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
  padding: 4px;
}

.slash-row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 7px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.slash-row:hover,
.slash-row.active {
  background: color-mix(in srgb, var(--primary, #3b82f6) 12%, transparent);
}

.cmd {
  font-family: var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desc {
  font-size: 11px;
  color: var(--fg-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kind {
  font-size: 10px;
  color: var(--fg-faint, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.slash-row.skill .kind {
  color: color-mix(in srgb, var(--primary, #3b82f6) 70%, var(--fg-muted));
}
</style>
