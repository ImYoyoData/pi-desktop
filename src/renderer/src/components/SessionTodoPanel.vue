<script setup lang="ts">
import { computed, ref } from "vue";
import { NIcon, NText } from "naive-ui";
import {
  CheckmarkCircle,
  ChevronDownOutline,
  ChevronForwardOutline,
  EllipseOutline,
} from "@vicons/ionicons5";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { t } from "@renderer/i18n";

const widgets = useSessionWidgetsStore();
const collapsed = ref(false);

const list = computed(() => widgets.activeTodoList);

const doneCount = computed(
  () => list.value?.items.filter((i) => i.done).length ?? 0,
);
const total = computed(() => list.value?.items.length ?? 0);
const allDone = computed(() => total.value > 0 && doneCount.value === total.value);

const headerLabel = computed(() => {
  if (!list.value) return "";
  if (allDone.value) return t.todoAllDone(total.value);
  return t.todoProgress(doneCount.value, total.value);
});
</script>

<template>
  <div v-if="list" class="todo-panel" role="region" :aria-label="headerLabel">
    <button type="button" class="todo-head pi-interactive" @click="collapsed = !collapsed">
      <NIcon
        :component="collapsed ? ChevronForwardOutline : ChevronDownOutline"
        :size="14"
        class="chev"
      />
      <span class="title">{{ headerLabel }}</span>
      <NText depth="3" class="meta">{{ doneCount }}/{{ total }}</NText>
    </button>

    <ul v-show="!collapsed" class="todo-list">
      <li
        v-for="item in list.items"
        :key="item.id"
        class="todo-item"
        :class="{ done: item.done }"
      >
        <NIcon
          :component="item.done ? CheckmarkCircle : EllipseOutline"
          :size="15"
          class="mark"
        />
        <span class="text">{{ item.text }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.todo-panel {
  flex-shrink: 0;
  margin: 0 var(--chat-pad-x, 10px) 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-elevated, var(--bg));
  overflow: hidden;
}

.todo-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.todo-head:hover {
  background: var(--bg-hover, color-mix(in srgb, var(--fg) 4%, transparent));
}

.chev {
  color: var(--fg-muted);
  flex-shrink: 0;
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px 0;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--fg);
}

.todo-item.done {
  color: var(--fg-muted);
}

.todo-item.done .text {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--fg-muted) 55%, transparent);
}

.mark {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--fg-muted);
}

.todo-item.done .mark {
  color: var(--success, #3d9a6a);
}

.text {
  min-width: 0;
  word-break: break-word;
}
</style>
