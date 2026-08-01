<script setup lang="ts">
import { computed, ref } from "vue";
import { NIcon } from "naive-ui";
import {
  CheckmarkDoneOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseOutline,
  ListOutline,
} from "@vicons/ionicons5";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { useSessionsStore } from "@renderer/stores/sessions";
import { t } from "@renderer/i18n";

const widgets = useSessionWidgetsStore();
const sessions = useSessionsStore();
const collapsed = ref(false);

const list = computed(() => widgets.activeTodoList);

const doneCount = computed(
  () => list.value?.items.filter((i) => i.done).length ?? 0,
);
const total = computed(() => list.value?.items.length ?? 0);
const openCount = computed(() => Math.max(0, total.value - doneCount.value));
const allDone = computed(() => total.value > 0 && openCount.value === 0);
const pct = computed(() =>
  total.value > 0 ? Math.round((doneCount.value / total.value) * 100) : 0,
);

const openItems = computed(() => (list.value?.items ?? []).filter((i) => !i.done));
const doneItems = computed(() => (list.value?.items ?? []).filter((i) => i.done));

const headerLabel = computed(() => {
  if (!list.value) return "";
  if (allDone.value) return t.todoAllDone(total.value);
  return t.todoProgress(doneCount.value, total.value);
});

const subLabel = computed(() => {
  if (!list.value) return "";
  if (allDone.value) return t.todoDoneItems;
  return t.todoRemaining(openCount.value);
});

function onDismiss(): void {
  const id = sessions.activeId;
  if (id) widgets.dismissTodoList(id);
}
</script>

<template>
  <div
    v-if="list"
    class="todo-panel"
    role="region"
    :aria-label="headerLabel"
    :class="{ done: allDone }"
  >
    <div class="todo-head">
      <button
        type="button"
        class="todo-toggle pi-interactive"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <NIcon
          :component="collapsed ? ChevronForwardOutline : ChevronDownOutline"
          :size="14"
          class="chev"
        />
        <span class="badge" :class="{ done: allDone }" aria-hidden="true">
          <NIcon
            :component="allDone ? CheckmarkDoneOutline : ListOutline"
            :size="13"
          />
        </span>
        <span class="title">{{ headerLabel }}</span>
        <span class="pill" :class="{ open: openCount > 0, done: allDone }">
          {{ subLabel }}
        </span>
      </button>
      <button
        type="button"
        class="dismiss pi-interactive"
        :aria-label="t.todoDismiss"
        :title="t.todoDismiss"
        @click="onDismiss"
      >
        <NIcon :component="CloseOutline" :size="13" />
      </button>
    </div>

    <div v-show="!collapsed">
      <div class="todo-progress" :class="{ done: allDone }">
        <div class="todo-progress-fill" :style="{ width: pct + '%' }" />
      </div>

      <TransitionGroup tag="ul" name="todo" class="todo-list">
        <li
          v-for="item in openItems"
          :key="'open-' + item.id"
          class="todo-item"
        >
          <span class="mark open" aria-hidden="true" />
          <span class="text">{{ item.text }}</span>
        </li>
        <li
          v-if="doneItems.length"
          key="__done-divider__"
          class="done-divider"
        >
          <span>{{ t.todoDoneItems }}</span>
        </li>
        <li
          v-for="item in doneItems"
          :key="'done-' + item.id"
          class="todo-item done"
        >
          <span class="mark done" aria-hidden="true" />
          <span class="text">{{ item.text }}</span>
        </li>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.todo-panel {
  flex-shrink: 0;
  margin: 0 var(--chat-pad-x, 12px) 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-elevated, var(--bg));
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.04));
  overflow: hidden;
  animation: todo-rise 220ms var(--ease-out, ease);
}

@keyframes todo-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.todo-head {
  display: flex;
  align-items: center;
  gap: 2px;
}

.todo-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  padding: 8px 6px 8px 9px;
  border: 0;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.todo-toggle:hover {
  background: var(--bg-hover, color-mix(in srgb, var(--fg) 4%, transparent));
}

.chev {
  color: var(--fg-faint, var(--fg-muted));
  flex-shrink: 0;
}

.badge {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
}

.badge.done {
  color: var(--success, var(--green, #16a34a));
  background: color-mix(in srgb, var(--success, var(--green, #16a34a)) 12%, transparent);
  border-color: color-mix(in srgb, var(--success, var(--green, #16a34a)) 30%, transparent);
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pill {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg-muted) 10%, transparent);
}

.pill.open {
  color: var(--accent);
  background: var(--accent-soft);
}

.pill.done {
  color: var(--success, var(--green, #16a34a));
  background: color-mix(in srgb, var(--success, var(--green, #16a34a)) 12%, transparent);
}

.dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 6px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--fg-faint, var(--fg-muted));
  cursor: pointer;
  flex-shrink: 0;
}

.dismiss:hover {
  background: var(--bg-hover, color-mix(in srgb, var(--fg) 5%, transparent));
  color: var(--fg);
}

.todo-progress {
  height: 3px;
  margin: 0 10px 7px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--fg-muted) 13%, transparent);
  overflow: hidden;
}

.todo-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    var(--accent),
    color-mix(in srgb, var(--accent) 55%, #38bdf8)
  );
  transition: width 0.3s var(--ease-out, ease);
}

.todo-progress.done .todo-progress-fill {
  background: linear-gradient(
    90deg,
    var(--success, var(--green, #16a34a)),
    color-mix(in srgb, var(--success, var(--green, #16a34a)) 60%, #4ade80)
  );
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong, var(--border)) transparent;
}

.todo-list::-webkit-scrollbar {
  width: 8px;
}

.todo-list::-webkit-scrollbar-thumb {
  background: var(--border-strong, var(--border));
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: content-box;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--fg);
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.todo-item:hover {
  background: var(--bg-hover, color-mix(in srgb, var(--fg) 4%, transparent));
}

.todo-item.done {
  color: var(--fg-muted);
}

.todo-item.done .text {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--fg-muted) 50%, transparent);
}

.mark {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border-radius: 4px;
  border: 1.5px solid var(--border-strong, var(--border));
  box-sizing: border-box;
  transition:
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    border-color var(--duration-fast, 140ms) var(--ease-out, ease),
    transform var(--duration-fast, 140ms) var(--ease-out, ease);
}

.todo-item:hover .mark.open {
  border-color: var(--accent-border);
}

.mark.done {
  position: relative;
  border-color: var(--success, var(--green, #16a34a));
  background: var(--success, var(--green, #16a34a));
}

.mark.done::after {
  content: "";
  position: absolute;
  left: 3.5px;
  top: 1px;
  width: 4px;
  height: 7px;
  border: solid #fff;
  border-width: 0 1.8px 1.8px 0;
  transform: rotate(42deg);
  border-radius: 1px;
}

.text {
  min-width: 0;
  word-break: break-word;
}

.done-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 4px 2px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-faint, var(--fg-muted));
}

.done-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--border) 80%, transparent);
}

.todo-enter-active,
.todo-leave-active {
  transition:
    opacity 160ms var(--ease-out, ease),
    transform 160ms var(--ease-out, ease);
}

.todo-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.todo-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.todo-move {
  transition: transform 180ms var(--ease-out, ease);
}

@media (prefers-reduced-motion: reduce) {
  .todo-panel {
    animation: none;
  }

  .todo-enter-active,
  .todo-leave-active,
  .todo-move {
    transition: none;
  }
}
</style>
