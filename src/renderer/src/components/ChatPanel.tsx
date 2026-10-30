import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Tag } from "antd";
import PermissionStrip from "@renderer/components/PermissionStrip";
import ExtensionUiStrip from "@renderer/components/ExtensionUiStrip";
import SessionTodoPanel from "@renderer/components/SessionTodoPanel";
import SessionChangedFiles from "@renderer/components/SessionChangedFiles";
import SessionStatsBar, { useSessionStats } from "@renderer/components/SessionStatsBar";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { hasAnyFileChange } from "@renderer/utils/session-file-changes";
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

  const sessionStats = useSessionStats();

  return (
    <section className={`chat-panel ${styles.chatPanel}`}>
      {hasSession ? (
        <>
          {/* 标题在窗口标题栏，消息区只留重试提示。 */}
          {chat.activeRetryHint ? (
            <header className={`chat-panel-head ${styles.chatPanelHead}`}>
              <Tag color="warning" variant="filled" className={styles.tag}>
                {t.retrying(
                  chat.activeRetryHint.attempt,
                  chat.activeRetryHint.maxAttempts,
                )}
              </Tag>
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
          <PermissionStrip />
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
          <SessionStatsBar stats={sessionStats} />
        </>
      ) : null}
    </section>
  );
}

export default ChatPanel;
