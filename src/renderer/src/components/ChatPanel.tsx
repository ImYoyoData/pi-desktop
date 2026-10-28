import {
  lazy,
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
import SessionStatsBar from "@renderer/components/SessionStatsBar";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useChatStore } from "@renderer/stores/chat";
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
            <Suspense fallback={null}>
              <MessageList
                messages={chat.activeMessages}
                streaming={chat.activeStreaming}
                running={running}
                retryHint={chat.activeRetryHint}
                historyLoading={chat.historyLoading}
                visible={visible !== false}
              />
            </Suspense>
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
          <SessionStatsBar />
        </>
      ) : null}
    </section>
  );
}

export default ChatPanel;
