<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
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
const paused = computed(() => Boolean(list.value?.paused));

/** Live tick for in-progress durations — re-renders the panel every second.
 *  A paused round holds its timers (no ticking until resumed). */
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
    // Tick only while open items remain, so each in-progress row keeps its
    // own live timer. Once everything is done the total timer is frozen.
    return l.items.some((i) => !i.done);
  },
  (hasActive) => {
    if (hasActive) startTick();
    else stopTick();
  },
  { immediate: true },
);

onBeforeUnmount(stopTick);

/** "12s" / "1m 23s" / "2h 5m" from ms. */
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

/** 未完成的项：用 startedAt + 本地 tick 实时跳动；已完成用固定时长 */
function itemDuration(item: {
  durationMs?: number;
  startedAt?: number;
  done: boolean;
  active?: boolean;
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
const pct = computed(() =>
  total.value > 0 ? Math.round((doneCount.value / total.value) * 100) : 0,
);

/** Any item actively running right now (drives the live pulse). */
const hasActive = computed(
  () => list.value?.items.some((i) => i.active && !i.done) ?? false,
);

/** 保持原始添加顺序，已完成与未完成混排在一起 */
const orderedItems = computed(() => list.value?.items ?? []);

/** 本轮待办总时长：从首次出现到全部完成（完成后冻结，不再走动） */
const totalDurationMs = computed(() => {
  const id = sessions.activeId;
  if (!id || !list.value) return 0;
  const start = widgets.todoStartedAt(id);
  if (!start) return 0;
  // 全部完成：起点 → 最后完成时刻（固定）；未完成：实时流逝时间。
  const end = widgets.todoCompletedAt(id) || nowMs.value;
  return Math.max(0, end - start);
});

const headerLabel = computed(() => {
  if (!list.value) return "";
  if (allDone.value) {
    const dur = formatDuration(totalDurationMs.value);
    return dur ? `${t.todoAllDone(total.value)} · ${dur}` : t.todoAllDone(total.value);
  }
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

/** Paused-round actions: keep the list for the follow-up prompt, or drop it. */
function onResume(): void {
  const id = sessions.activeId;
  if (id) widgets.resumeTodosForSession(id);
}

function onDeleteList(): void {
  const id = sessions.activeId;
  if (id) widgets.deleteTodoList(id);
}
</script>

<template>
  <div
    v-if="list"
    class="todo-panel"
    role="region"
    :aria-label="headerLabel"
    :class="{ done: allDone, paused }"
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
        <span class="badge" :class="{ done: allDone, paused }" aria-hidden="true">
          <NIcon
            :component="allDone ? CheckmarkDoneOutline : ListOutline"
            :size="13"
          />
        </span>
        <span class="title">{{ headerLabel }}</span>
        <span
          class="pill"
          :class="{ open: openCount > 0, done: allDone, live: hasActive && !paused }"
        >
          <span v-if="hasActive && !paused" class="live-dot" aria-hidden="true" />
          {{ paused ? t.todoPaused : subLabel }}
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

    <!-- Paused round: user decides to continue or delete — never auto-done. -->
    <div v-if="paused" class="todo-paused-actions">
      <button type="button" class="tp-btn primary pi-interactive" @click="onResume">
        {{ t.todoResumeTask }}
      </button>
      <button type="button" class="tp-btn danger pi-interactive" @click="onDeleteList">
        {{ t.todoDeleteList }}
      </button>
    </div>

    <div v-show="!collapsed">
      <div class="todo-progress" :class="{ done: allDone }">
        <div class="todo-progress-fill" :style="{ width: pct + '%' }" />
      </div>

      <TransitionGroup tag="ul" name="todo" class="todo-list">
        <li
          v-for="item in orderedItems"
          :key="item.id"
          class="todo-item"
          :class="{
            done: item.done,
            active: item.active && !item.done,
          }"
        >
          <span v-if="item.active && !item.done" class="mark active" aria-hidden="true">
            <span v-if="!paused" class="spinner" />
            <span v-else class="pause-glyph" />
          </span>
          <span v-else class="mark" :class="item.done ? 'done' : 'open'" aria-hidden="true" />
          <span class="num" aria-hidden="true">{{ item.id }}</span>
          <span class="text">{{ item.text }}</span>
          <span
            v-if="itemDuration(item)"
            class="dur"
            :class="{ active: item.active && !item.done }"
          >
            {{ itemDuration(item) }}
          </span>
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
  border-radius: 12px;
  background: var(--tool-bg, #f5f6f7);
  box-shadow: none;
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

.badge.paused {
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg-muted) 10%, transparent);
  border-color: color-mix(in srgb, var(--fg-muted) 25%, transparent);
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

/* Live indicator: breathing dot + soft pulse while an item is running. */
.pill.live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  animation: todo-live-pulse 1.6s ease-in-out infinite;
}

.live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

@keyframes todo-live-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent);
  }
  55% {
    box-shadow: 0 0 0 4px transparent;
  }
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
  align-items: center;
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

.todo-item.active {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.num {
  flex-shrink: 0;
  min-width: 16px;
  text-align: center;
  font-size: 10.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--fg-faint, var(--fg-muted));
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.todo-item.done .num {
  color: color-mix(in srgb, var(--success, var(--green, #16a34a)) 75%, var(--fg-faint));
}

.todo-item.active .num {
  color: var(--accent);
}

.dur {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-faint, var(--fg-muted));
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: nowrap;
}

.dur.active {
  color: var(--accent);
}

.mark {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-top: 0;
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

.mark.active {
  border-color: transparent;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mark.active .spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: todo-spin 0.7s linear infinite;
}

/* Paused round: static pause bars instead of the spinner; timers hold. */
.pause-glyph {
  display: inline-block;
  width: 8px;
  height: 10px;
  border-left: 2.5px solid var(--fg-muted);
  border-right: 2.5px solid var(--fg-muted);
  border-radius: 1px;
}

.todo-paused-actions {
  display: flex;
  gap: 6px;
  padding: 0 10px 9px;
}

.tp-btn {
  flex: 1;
  padding: 4px 10px;
  border: none;
  border-radius: 7px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    color var(--duration-fast, 140ms) var(--ease-out, ease);
}

.tp-btn.primary {
  color: var(--accent-fg, #fff);
  background: var(--accent);
}

.tp-btn.primary:hover {
  background: var(--accent-hover, var(--accent));
}

.tp-btn.danger {
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg) 7%, transparent);
}

.tp-btn.danger:hover {
  color: var(--red, #ef4444);
  background: color-mix(in srgb, var(--red, #ef4444) 12%, transparent);
}

@keyframes todo-spin {
  to {
    transform: rotate(360deg);
  }
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

  .pill.live {
    animation: none;
  }

  .mark.active .spinner {
    animation-duration: 2s;
  }

  .todo-enter-active,
  .todo-leave-active,
  .todo-move {
    transition: none;
  }
}
</style>
