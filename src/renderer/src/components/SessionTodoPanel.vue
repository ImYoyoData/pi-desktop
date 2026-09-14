<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseOutline,
} from "@vicons/ionicons5";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useChatStore } from "@renderer/stores/chat";
import { t } from "@renderer/i18n";

/**
 * Copilot chatTodoListWidget — a docked slice on the chat input stack.
 *
 * A fresh round (nothing done / nothing in-progress) renders expanded so the
 * plan is visible; once any item is in-progress or done the list auto-folds to
 * a compact header showing the current task "<task> (N/M)" with a leading
 * status dot (Copilot `updateTitleElement`). Manual expand/collapse sticks.
 */

const widgets = useSessionWidgetsStore();
const sessions = useSessionsStore();
const chat = useChatStore();

const list = computed(() => widgets.activeTodoList);
const paused = computed(() => Boolean(list.value?.paused));

/** User manually opened/closed the list — overrides auto-collapse. */
const userExpanded = ref<boolean | null>(null);

/** Live tick for in-progress durations — re-renders every second. */
const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
function startTick(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
}
function stopTick(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

watch(
  () => {
    const l = widgets.activeTodoList;
    if (!l || l.paused) return false;
    return l.items.some((i) => !i.done);
  },
  (hasActive) => {
    if (hasActive) startTick();
    else stopTick();
  },
  { immediate: true },
);

onBeforeUnmount(stopTick);

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
}

function itemDuration(item: {
  durationMs?: number;
  startedAt?: number;
  done: boolean;
}): string {
  if (item.durationMs != null) return formatDuration(item.durationMs);
  if (!item.done && item.startedAt != null) {
    return formatDuration(nowMs.value - item.startedAt);
  }
  return "";
}

const doneCount = computed(
  () => list.value?.items.filter((i) => i.done).length ?? 0,
);
const total = computed(() => list.value?.items.length ?? 0);
const openCount = computed(() => Math.max(0, total.value - doneCount.value));
const allDone = computed(() => total.value > 0 && openCount.value === 0);

const firstInProgress = computed(
  () => list.value?.items.find((i) => i.active && !i.done) ?? null,
);
const firstOpen = computed(
  () => list.value?.items.find((i) => !i.done) ?? null,
);

/** A "fresh" round: nothing completed and nothing currently in-progress. */
const freshRound = computed(
  () =>
    list.value != null &&
    doneCount.value === 0 &&
    !firstInProgress.value &&
    !paused.value,
);

/** Copilot auto-collapse — re-expands fresh rounds unless user overrode. */
const collapsed = computed(() => {
  // Paused round: always show the continue/delete actions.
  if (paused.value) return false;
  if (userExpanded.value !== null) return !userExpanded.value;
  if (freshRound.value) return false;
  // In-progress / completed round folds to the "current task" header.
  return true;
});

/** Watch list content to reset the user override on a brand-new round. */
watch(
  () => list.value?.items.map((i) => `${i.id}:${i.done}:${i.active}`).join("|"),
  () => {
    if (freshRound.value) userExpanded.value = null;
  },
);

function toggle(): void {
  userExpanded.value = collapsed.value;
}

/** Copilot "current task number": completed+1 while something is in-progress. */
const currentNumber = computed(() =>
  Math.max(doneCount.value + (firstInProgress.value ? 1 : 0), 1),
);

const expandedTitle = computed(() =>
  total.value > 0
    ? t.todoProgress(currentNumber.value, total.value)
    : t.toolTodo,
);

/** Collapsed header mirrors Copilot: "<current task> (N/M)". */
const collapsedTitle = computed(() => {
  const l = list.value;
  if (!l) return "";
  const shown = firstInProgress.value ?? firstOpen.value;
  if (!shown) return expandedTitle.value;
  return `${shown.text} (${currentNumber.value}/${total.value})`;
});

const headerLabel = computed(() =>
  collapsed.value ? collapsedTitle.value : expandedTitle.value,
);

const subLabel = computed(() => {
  if (paused.value) return t.todoPaused;
  if (allDone.value) return t.todoDoneItems;
  return t.todoRemaining(openCount.value);
});

const hasLive = computed(
  () => list.value?.items.some((i) => i.active && !i.done) ?? false,
);

function onDismiss(): void {
  const id = sessions.activeId;
  if (id) widgets.dismissTodoList(id);
}

function onResume(): void {
  const id = sessions.activeId;
  if (!id) return;
  // 先解除暂停：本次 sendPrompt 的新任务重置由 skipNextReset 跳过，列表得以保留。
  widgets.resumeTodosForSession(id);
  void chat.sendPrompt(
    id,
    t.todoContinuePrompt,
    undefined,
    undefined,
    undefined,
    t.todoResumeTask,
  );
}

function onDeleteList(): void {
  const id = sessions.activeId;
  if (id) widgets.deleteTodoList(id);
}
</script>

<template>
  <div
    v-if="list"
    class="todo-dock"
    role="region"
    :aria-label="headerLabel"
    :class="{ done: allDone, paused, expanded: !collapsed }"
  >
    <div class="todo-dock-head">
      <button
        type="button"
        class="todo-dock-toggle pi-interactive"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? t.todoExpand : t.todoCollapse"
        @click="toggle"
      >
        <NIcon
          class="chev"
          :component="collapsed ? ChevronForwardOutline : ChevronDownOutline"
          :size="13"
          aria-hidden="true"
        />
        <span v-if="collapsed" class="head-lead" aria-hidden="true">
          <span
            class="lead-mark"
            :class="firstInProgress ? 'in-progress' : allDone ? 'done' : 'open'"
          />
        </span>
        <span class="todo-dock-title">{{ headerLabel }}</span>
        <span
          class="todo-dock-pill"
          :class="{ live: hasLive && !paused, paused }"
        >
          {{ subLabel }}
        </span>
      </button>

      <button
        type="button"
        class="todo-dock-close pi-interactive"
        :aria-label="t.todoDismiss"
        :title="t.todoDismiss"
        @click="onDismiss"
      >
        <NIcon :component="CloseOutline" :size="13" />
      </button>
    </div>

    <!-- Paused round: continue or delete. -->
    <div v-if="paused && !collapsed" class="todo-paused-actions">
      <button type="button" class="tp-btn primary pi-interactive" @click="onResume">
        {{ t.todoResumeTask }}
      </button>
      <button type="button" class="tp-btn danger pi-interactive" @click="onDeleteList">
        {{ t.todoDeleteList }}
      </button>
    </div>

    <Transition name="todo-expand">
      <div v-show="!collapsed" class="todo-dock-body">
        <ul class="todo-list" role="list">
          <li
            v-for="item in list.items"
            :key="item.id"
            class="todo-item"
            :class="{ done: item.done, live: item.active && !item.done }"
            role="listitem"
          >
            <span class="todo-status" aria-hidden="true">
              <span
                class="st-mark"
                :class="item.done ? 'done' : item.active ? 'in-progress' : 'open'"
              />
            </span>
            <span class="todo-text">{{ item.text }}</span>
            <span
              v-if="itemDuration(item)"
              class="todo-dur"
              :class="{ live: item.active && !item.done }"
            >
              {{ itemDuration(item) }}
            </span>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Copilot chatTodoListWidget — docks flush onto the composer
   surface. Border/radius are provided by the enclosing .chat-input-stack
   (each member is a borderless slice). */

.todo-dock {
  flex-shrink: 0;
  min-width: 0;
  background: transparent;
}

.todo-dock-head {
  display: flex;
  align-items: center;
  gap: 2px;
}

.todo-dock-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px 0 2px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  font: inherit;
  user-select: none;
}

.todo-dock-toggle:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.chev {
  flex-shrink: 0;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.head-lead {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.lead-mark {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-sizing: border-box;
}

.lead-mark.in-progress {
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  animation: lead-pulse 1.4s ease-in-out infinite;
}

.lead-mark.open {
  border: 1.5px solid var(--border-strong, var(--fg-faint));
}

.lead-mark.done {
  background: var(--success, var(--green));
  box-shadow: 0 0 0 3px
    color-mix(in srgb, var(--success, var(--green)) 18%, transparent);
}

@keyframes lead-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.88);
  }
}

.todo-dock-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--chat-font-s, 12px);
  font-weight: 500;
  line-height: 22px;
  color: var(--fg);
}

.todo-dock-pill {
  flex-shrink: 0;
  margin-right: 2px;
  font-size: var(--chat-font-xs, 11px);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.todo-dock-pill.live {
  color: var(--accent);
}

.todo-dock-pill.paused {
  font-style: italic;
}

.todo-dock-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 2px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--chat-icon-fg, var(--fg-muted));
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms ease,
    background 120ms ease,
    color 120ms ease;
}

.todo-dock:hover .todo-dock-close,
.todo-dock:focus-within .todo-dock-close,
.todo-dock.expanded .todo-dock-close {
  opacity: 1;
}

.todo-dock-close:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 6%, transparent));
  color: var(--fg);
}

.todo-paused-actions {
  display: flex;
  gap: 6px;
  padding: 0 10px 8px;
}

.tp-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  font: inherit;
  font-size: var(--chat-font-s, 12px);
  font-weight: 600;
  cursor: pointer;
}

.tp-btn.primary {
  color: var(--accent);
  background: var(--accent-soft);
}

.tp-btn.primary:hover {
  background: var(--accent-soft-hover, var(--accent-soft));
}

.tp-btn.danger {
  color: var(--red, var(--fg-muted));
  background: color-mix(in srgb, var(--red, #ef4444) 10%, transparent);
}

.tp-btn.danger:hover {
  background: color-mix(in srgb, var(--red, #ef4444) 16%, transparent);
}

.todo-dock-body {
  min-width: 0;
  padding: 0 6px 6px;
}

.todo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 198px;
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
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: var(--chat-font-m, 13px);
  line-height: 1.5;
  color: var(--fg);
}

.todo-item:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.todo-item.live {
  background: var(--accent-soft);
}

.todo-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.st-mark {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-sizing: border-box;
  flex-shrink: 0;
}

.st-mark.in-progress {
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
  animation: st-pulse 1.1s ease-in-out infinite;
}

.st-mark.open {
  border: 1.5px solid var(--border-strong, var(--fg-faint));
}

.st-mark.done {
  background: var(--success, var(--green));
  border: none;
  position: relative;
}

.st-mark.done::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 1px;
  width: 3px;
  height: 6px;
  border: solid #fff;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(42deg);
}

@keyframes st-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.86);
  }
}

.todo-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.todo-item.done .todo-text {
  color: var(--chat-desc-fg, var(--fg-muted));
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--fg-muted) 45%, transparent);
}

.todo-dur {
  flex-shrink: 0;
  margin-left: auto;
  font-size: var(--chat-font-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--chat-icon-fg, var(--fg-muted));
  white-space: nowrap;
}

.todo-dur.live {
  color: var(--accent);
}

/* Expand/collapse animation */
.todo-expand-enter-active,
.todo-expand-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
  overflow: hidden;
}

.todo-expand-enter-from,
.todo-expand-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {
  .lead-mark.in-progress,
  .st-mark.in-progress {
    animation: none;
  }

  .todo-expand-enter-active,
  .todo-expand-leave-active {
    transition: none;
  }
}
</style>
