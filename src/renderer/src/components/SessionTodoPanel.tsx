import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseOutline,
} from "@renderer/components/icons/ionicons";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useChatStore } from "@renderer/stores/chat";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./SessionTodoPanel.module.css";

/**
 * Copilot chatTodoListWidget — a docked slice on the chat input stack.
 *
 * A fresh round (nothing done / nothing in-progress) renders expanded so the
 * plan is visible; once any item is in-progress or done the list auto-folds to
 * a compact header showing the current task "<task> (N/M)" with a leading
 * status dot (Copilot `updateTitleElement`). Manual expand/collapse sticks.
 */

type BodyPhase = "hidden" | "enter" | "shown" | "leave";

type DurationItem = {
  durationMs?: number;
  startedAt?: number;
  done: boolean;
};

const EXPAND_ANIM_MS = 140;

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

function itemDuration(item: DurationItem, nowMs: number): string {
  if (item.durationMs != null) return formatDuration(item.durationMs);
  if (!item.done && item.startedAt != null) {
    return formatDuration(nowMs - item.startedAt);
  }
  return "";
}

export function SessionTodoPanel(): ReactNode {
  const t = useI18n();
  const widgets = useSessionWidgetsStore();

  const list = widgets.activeTodoList;
  const items = list?.items ?? [];
  const paused = Boolean(list?.paused);

  /** User manually opened/closed the list — overrides auto-collapse. */
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const openCount = Math.max(0, total - doneCount);
  const allDone = total > 0 && openCount === 0;
  /** 回合结束时模型没回写状态的项 —— 面板真话：不打勾，提示待确认。 */
  const unreportedCount = items.filter((i) => i.unreported && !i.done).length;
  const firstInProgress = items.find((i) => i.active && !i.done) ?? null;
  const firstOpen = items.find((i) => !i.done) ?? null;
  /** A "fresh" round: nothing completed and nothing currently in-progress. */
  const freshRound =
    list != null && doneCount === 0 && !firstInProgress && !paused;
  /** Copilot auto-collapse — re-expands fresh rounds unless user overrode. */
  const collapsed = paused
    ? false
    : userExpanded !== null
      ? !userExpanded
      : !freshRound;

  const [phase, setPhase] = useState<BodyPhase>(() =>
    collapsed ? "hidden" : "shown",
  );
  const phaseTimer = useRef(0);
  const firstPhaseRun = useRef(true);

  /** Live tick for in-progress durations — re-renders every second. */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hasActiveItem = useMemo(() => {
    const l = widgets.activeTodoList;
    if (!l || l.paused) return false;
    // 未完成且耗时还没冻结的项才需要秒级重算；「未回写」项的耗时已冻结。
    return l.items.some((i) => !i.done && i.durationMs == null);
  }, [widgets.activeTodoList]);

  useEffect(() => {
    if (!hasActiveItem) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveItem]);

  useEffect(() => {
    return () => window.clearTimeout(phaseTimer.current);
  }, []);

  useEffect(() => {
    if (firstPhaseRun.current) {
      firstPhaseRun.current = false;
      return;
    }
    window.clearTimeout(phaseTimer.current);
    if (collapsed) {
      setPhase("leave");
      phaseTimer.current = window.setTimeout(
        () => setPhase("hidden"),
        EXPAND_ANIM_MS,
      );
      return;
    }
    setPhase("enter");
    phaseTimer.current = window.setTimeout(
      () => setPhase("shown"),
      EXPAND_ANIM_MS,
    );
  }, [collapsed]);

  /** Watch list content to reset the user override on a brand-new round. */
  const listKey = useMemo(
    () => items.map((i) => `${i.id}:${i.done}:${i.active}`).join("|"),
    [items],
  );
  useEffect(() => {
    if (freshRound) setUserExpanded(null);
  }, [listKey]);

  const rows = useMemo(
    () => items.map((item) => ({ item, duration: itemDuration(item, nowMs) })),
    [items, nowMs],
  );

  const toggle = useCallback((): void => {
    setUserExpanded(collapsed);
  }, [collapsed]);

  const onDismiss = useCallback((): void => {
    const id = useSessionsStore.getState().activeId;
    if (id) useSessionWidgetsStore.getState().dismissTodoList(id);
  }, []);

  const onResume = useCallback((): void => {
    const id = useSessionsStore.getState().activeId;
    if (!id) return;
    // 先解除暂停：本次 sendPrompt 的新任务重置由 skipNextReset 跳过，列表得以保留。
    useSessionWidgetsStore.getState().resumeTodosForSession(id);
    void useChatStore.getState().sendPrompt(id, t.todoResumeTask);
  }, [t]);

  const onDeleteList = useCallback((): void => {
    const id = useSessionsStore.getState().activeId;
    if (id) useSessionWidgetsStore.getState().deleteTodoList(id);
  }, []);

  if (!list) return null;

  /** Copilot "current task number": completed+1 while something is in-progress. */
  const currentNumber = Math.max(doneCount + (firstInProgress ? 1 : 0), 1);

  const expandedTitle =
    total > 0 ? t.todoProgress(currentNumber, total) : t.toolTodo;

  /** Collapsed header mirrors Copilot: "<current task> (N/M)". */
  const shown = firstInProgress ?? firstOpen;
  const collapsedTitle = !shown ? expandedTitle : `${shown.text} (${currentNumber}/${total})`;

  const headerLabel = collapsed ? collapsedTitle : expandedTitle;

  const subLabel = paused
    ? t.todoPaused
    : unreportedCount > 0
      ? t.todoUnreported(unreportedCount)
      : allDone
        ? t.todoDoneItems
        : t.todoRemaining(openCount);

  const hasLive = items.some((i) => i.active && !i.done);

  return (
    <div
      className={`todo-dock ${styles.todoDock} ${collapsed ? "" : styles.expanded}`}
      role="region"
      aria-label={headerLabel}
    >
      <div className={styles.todoDockHead}>
        <button
          type="button"
          className={`pi-interactive ${styles.todoDockToggle}`}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.todoExpand : t.todoCollapse}
          onClick={toggle}
        >
          {collapsed ? (
            <ChevronForwardOutline className={styles.chev} size={13} />
          ) : (
            <ChevronDownOutline className={styles.chev} size={13} />
          )}
          {collapsed ? (
            <span className={styles.headLead} aria-hidden="true">
              <span
                className={`${styles.leadMark} ${firstInProgress ? styles.inProgress : allDone ? styles.done : styles.open}`}
              />
            </span>
          ) : null}
          <span className={styles.todoDockTitle}>{headerLabel}</span>
          <span
            className={`${styles.todoDockPill} ${hasLive && !paused ? styles.live : ""} ${paused ? styles.paused : ""}`}
          >
            {subLabel}
          </span>
        </button>

        <button
          type="button"
          className={`pi-interactive ${styles.todoDockClose}`}
          aria-label={t.todoDismiss}
          title={t.todoDismiss}
          onClick={onDismiss}
        >
          <CloseOutline size={13} />
        </button>
      </div>

      {/* Paused round: continue or delete. */}
      {paused && !collapsed ? (
        <div className={styles.todoPausedActions}>
          <button
            type="button"
            className={`pi-interactive ${styles.tpBtn} ${styles.primary}`}
            onClick={onResume}
          >
            {t.todoResumeTask}
          </button>
          <button
            type="button"
            className={`pi-interactive ${styles.tpBtn} ${styles.danger}`}
            onClick={onDeleteList}
          >
            {t.todoDeleteList}
          </button>
        </div>
      ) : null}

      {phase === "hidden" ? null : (
        <div
          className={`${styles.todoDockBody} ${phase === "enter" ? styles.bodyEnter : ""} ${phase === "leave" ? styles.bodyLeave : ""}`}
        >
          <ul className={styles.todoList} role="list">
            {rows.map(({ item, duration }) => (
              <li
                key={item.id}
                className={`${styles.todoItem} ${item.done ? styles.done : ""} ${item.active && !item.done ? styles.live : ""} ${item.unreported && !item.done ? styles.unreported : ""}`}
                role="listitem"
              >
                <span className={styles.todoStatus} aria-hidden="true">
                  <span
                    className={`${styles.stMark} ${item.done ? styles.done : item.unreported ? styles.unreported : item.active ? styles.inProgress : styles.open}`}
                  />
                </span>
                <span className={styles.todoText}>{item.text}</span>
                {duration ? (
                  <span
                    className={`${styles.todoDur} ${item.active && !item.done ? styles.live : ""}`}
                  >
                    {duration}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SessionTodoPanel;
