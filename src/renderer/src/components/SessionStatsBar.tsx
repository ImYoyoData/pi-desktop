import { useDeferredValue, useMemo, type ReactNode } from "react";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionStatsStore } from "@renderer/stores/session-stats";
import { useSessionsStore } from "@renderer/stores/sessions";
import {
  buildSessionStats,
  sessionUsageFromMessages,
} from "@renderer/utils/session-stats";
import styles from "./SessionStatsBar.module.css";

/**
 * 会话统计条：铺在主区底部，不跟随输入框的列宽。
 *
 * worker 冷启动期间没有 context_usage，先用已加载历史聚合出能算的项。
 */
export function SessionStatsBar(): ReactNode {
  const enabled = useAppearanceStore((s) => s.showSessionDetails);
  const contextUsage = useSessionsStore((s) => s.activeContextUsage);
  const tpsMode = useSessionStatsStore((s) => s.tpsMode);
  // 统计只影响底栏数字：切换会话时让它在后台算，别拖住输入区的首帧。
  const messages = useDeferredValue(useChatStore((s) => s.activeMessages));
  const fallbackUsage = useMemo(
    () => sessionUsageFromMessages(messages),
    [messages],
  );
  const stats = useMemo(
    () => buildSessionStats(contextUsage ?? fallbackUsage, tpsMode),
    [contextUsage, fallbackUsage, tpsMode],
  );

  if (!enabled || !stats) return null;
  return (
    <div className={styles.bar} role="status" aria-label="session statistics">
      {stats.map((item) => (
        <span key={item.key} className={styles.item} title={item.title}>
          <span className={styles.label}>{item.label}</span>
          <strong>{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

export default SessionStatsBar;
