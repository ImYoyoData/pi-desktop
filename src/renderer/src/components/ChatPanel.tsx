import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Tag, Typography } from "antd";
import AskUserStrip from "@renderer/components/AskUserStrip";
import ExtensionUiStrip from "@renderer/components/ExtensionUiStrip";
import SessionTodoPanel from "@renderer/components/SessionTodoPanel";
import SessionChangedFiles from "@renderer/components/SessionChangedFiles";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useChatStore } from "@renderer/stores/chat";
import type { MessageListProps } from "@renderer/components/MessageList";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { hasAnyFileChange } from "@renderer/utils/session-file-changes";
import { heuristicSessionTitle } from "@renderer/utils/session-title";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ChatPanel.module.css";

/**
 * Heaviest chat chrome — load lazily so first paint / session switch stays
 * responsive on slower CPUs (markdown + monaco parsing happens off the
 * critical path).
 */
const Composer = lazy(() => import("@renderer/components/Composer"));
const MessageList = lazy(() => import("@renderer/components/MessageList"));

/** 会话消息区的快照：切走的会话保留最后一次渲染的 props，切回来不再重建。 */
type PaneSnapshot = Omit<MessageListProps, "visible">;

/** 同时保留的消息区数量。再多，后台重渲染的收益就抵消了内存开销。 */
const MAX_CACHED_PANES = 3;

const SessionPane = memo(function SessionPane({
  snapshot,
  visible,
}: {
  snapshot: PaneSnapshot;
  visible: boolean;
}): ReactNode {
  return (
    <Suspense fallback={null}>
      <MessageList
        messages={snapshot.messages}
        streaming={snapshot.streaming}
        running={snapshot.running}
        retryHint={snapshot.retryHint}
        historyLoading={snapshot.historyLoading}
        visible={visible}
      />
    </Suspense>
  );
});

type Props = {
  /** 面板被折叠/让位给编辑器区域时不参与可见性：消息区据此暂停测量与贴底。 */
  visible?: boolean;
};

export function ChatPanel({ visible }: Props): ReactNode {
  const t = useI18n();
  const chat = useChatStore();
  const appearance = useAppearanceStore();
  const sessions = useSessionsStore();

  useEffect(() => {
    useSessionWidgetsStore.getState().restoreTodoSnapshots();
  }, []);

  /** Any docked widget (todo / changed files) above the composer? */
  const hasTodoDock = Boolean(useSessionWidgetsStore((s) => s.activeTodoList));

  /**
   * hasAnyFileChange scans every tool row per call; streaming ticks invalidate
   * it constantly. Throttle to a ~120ms trailing recompute — the dock gate only
   * needs to track presence, not per-tick truth.
   */
  const [hasFileDock, setHasFileDock] = useState(() =>
    hasAnyFileChange(chat.activeMessages, chat.activeStreaming),
  );
  const dockScanTimer = useRef(0);

  useEffect(() => {
    if (dockScanTimer.current) return;
    dockScanTimer.current = window.setTimeout(() => {
      dockScanTimer.current = 0;
      const state = useChatStore.getState();
      setHasFileDock(
        hasAnyFileChange(state.activeMessages, state.activeStreaming),
      );
    }, 120);
  }, [chat.activeMessages, chat.activeStreaming]);

  useEffect(() => {
    return () => {
      if (dockScanTimer.current) window.clearTimeout(dockScanTimer.current);
      dockScanTimer.current = 0;
    };
  }, []);

  const hasDock = hasTodoDock || hasFileDock;

  const isDraft = !sessions.activeId && Boolean(sessions.draftRoot);
  const hasSession = Boolean(sessions.activeId) || isDraft;

  const running = (() => {
    const id = sessions.activeId;
    if (!id) return false;
    const row = sessions.sessions.find((s) => s.id === id);
    return chat.activeRunning || row?.status === "running";
  })();

  useEffect(() => {
    // 进程级事件订阅由 app-events 随应用注册，不随本组件生死；这里只做一次
    // 权威状态对账，修正可能因事件丢失而卡住的「等待模型响应」。
    void useChatStore.getState().resyncActiveSession();
  }, []);

  /** 头部没有标题与状态标签时不渲染，避免留下一条空白分隔栏。 */
  const showHeader =
    appearance.showSessionTitle || Boolean(chat.activeRetryHint);

  const title = (() => {
    if (isDraft) return t.newSession;
    if (!sessions.activeId) return "";
    const row = sessions.sessions.find((s) => s.id === sessions.activeId);
    if (row?.name?.trim()) return row.name.trim();
    if (row?.firstMessage?.trim() && row.firstMessage !== "(no messages)") {
      const text = row.firstMessage.trim();
      return text.length > 56 ? `${text.slice(0, 53)}…` : text;
    }
    // 会话行不在当前工作区列表里（侧栏折叠/切换后保留旧会话）时用首条消息兜底。
    const firstUser = chat.activeMessages.find(
      (m) => m.role === "user" && m.text.trim(),
    );
    if (firstUser?.role === "user") {
      const text = heuristicSessionTitle(firstUser.text, 56);
      if (text) return text;
    }
    return t.newSession;
  })();

  const liveSnapshot: PaneSnapshot = {
    messages: chat.activeMessages,
    streaming: chat.activeStreaming,
    running,
    retryHint: chat.activeRetryHint,
    historyLoading: chat.historyLoading,
  };
  const paneCache = useRef(new Map<string, PaneSnapshot>());
  const paneIdsRef = useRef<string[]>([]);

  /**
   * 切走时把当前快照留在缓存里：旧会话的消息区继续挂载、只把 visibility 关掉，
   * 切回来不再重建 markdown 树（实测重建一次要 100ms 以上）。
   */
  if (sessions.activeId) {
    paneCache.current.set(sessions.activeId, liveSnapshot);
    const ids = paneIdsRef.current;
    if (ids[ids.length - 1] !== sessions.activeId) {
      const next = [
        ...ids.filter((id) => id !== sessions.activeId),
        sessions.activeId,
      ];
      paneIdsRef.current = next.slice(-MAX_CACHED_PANES);
      const keep = new Set(paneIdsRef.current);
      for (const id of [...paneCache.current.keys()]) {
        if (!keep.has(id)) paneCache.current.delete(id);
      }
    }
  }
  const paneIds = paneIdsRef.current;

  return (
    <section className={`chat-panel ${styles.chatPanel}`}>
      {hasSession ? (
        <>
          {showHeader ? (
            <header className={`chat-panel-head ${styles.chatPanelHead}`}>
              {appearance.showSessionTitle ? (
                <Typography.Text
                  strong
                  style={{ flex: 1, minWidth: 0 }}
                  className={styles.title}
                >
                  {title}
                </Typography.Text>
              ) : null}
              {chat.activeRetryHint ? (
                <Tag color="warning" variant="filled" className={styles.tag}>
                  {t.retrying(
                    chat.activeRetryHint.attempt,
                    chat.activeRetryHint.maxAttempts,
                  )}
                </Tag>
              ) : null}
            </header>
          ) : null}
          <div className={styles.messageSlot}>
            {paneIds.length > 0 ? (
              paneIds.map((id) => {
                const active = id === sessions.activeId;
                return (
                  <div
                    key={id}
                    className={styles.sessionPane}
                    style={
                      active
                        ? { zIndex: 1 }
                        : { visibility: "hidden", opacity: 0, pointerEvents: "none" }
                    }
                  >
                    <SessionPane
                      snapshot={paneCache.current.get(id) ?? liveSnapshot}
                      visible={active && visible !== false}
                    />
                  </div>
                );
              })
            ) : (
              <SessionPane snapshot={liveSnapshot} visible={visible !== false} />
            )}
          </div>
          <ExtensionUiStrip />
          {!chat.activePendingExtensionUi ? <AskUserStrip /> : null}
          {/* Docked widgets share one surface with the composer (chat-input-stack). */}
          <div className={styles.chatInputStack}>
            {hasDock ? (
              <div className={`stack-above ${styles.stackAbove}`}>
                <SessionTodoPanel />
                <SessionChangedFiles />
              </div>
            ) : null}
            <Suspense fallback={null}>
              <Composer docked={hasDock} />
            </Suspense>
          </div>
        </>
      ) : null}
    </section>
  );
}

export default ChatPanel;
