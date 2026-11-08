import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Empty } from "antd";
import PageHeader from "@renderer/components/PageHeader";
import PageSplit from "@renderer/components/PageSplit";
import SubagentTranscript from "@renderer/components/SubagentTranscript";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";
import {
  collectSubagents,
  type SubagentEntry,
} from "@renderer/utils/subagents";
import { formatDuration } from "@renderer/utils/format-duration";
import {
  CheckmarkCircleOutline,
  CloseOutline,
  EllipseOutline,
  SyncOutline,
} from "@renderer/components/icons/ionicons";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./AgentsPage.module.css";

type Props = {
  sideWidth: number;
  sideMinWidth: number;
  sideMaxWidth: number;
  onSideWidthChange: (width: number) => void;
};

/** 右侧列表：运行中优先（与 wait 卡同序），同状态按耗时降序。 */
function AgentList({
  agents,
  selectedId,
  onSelect,
}: {
  agents: SubagentEntry[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}): ReactNode {
  const t = useI18n();
  return (
    <div className={styles.list}>
      <ul className={styles.rows}>
        {agents.map((agent) => {
          const running = agent.status === "running";
          const failed = agent.status === "failed";
          const Icon = running
            ? SyncOutline
            : failed
              ? CloseOutline
              : agent.status === "completed"
                ? CheckmarkCircleOutline
                : EllipseOutline;
          return (
            <li
              key={agent.agentId}
              className={
                agent.agentId === selectedId
                  ? `${styles.row} ${styles.selected}`
                  : styles.row
              }
              title={agent.label}
              onClick={() => onSelect(agent.agentId)}
            >
              <Icon
                size={12}
                aria-hidden="true"
                className={
                  running
                    ? `${styles.statusIcon} ${styles.statusRunning}`
                    : failed
                      ? `${styles.statusIcon} ${styles.statusFailed}`
                      : styles.statusIcon
                }
              />
              <span className={styles.rowLabel}>{agent.label}</span>
              {agent.durationMs > 0 ? (
                <span className={styles.rowMeta}>
                  {formatDuration(agent.durationMs)}
                </span>
              ) : null}
              {running ? (
                <span className={styles.runningBadge}>{t.agentsRunning}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 子代理页：主区显示选中子代理的完整对话，右侧是该会话的子代理列表。 */
export function AgentsPage({
  sideWidth,
  sideMinWidth,
  sideMaxWidth,
  onSideWidthChange,
}: Props): ReactNode {
  const t = useI18n();
  const sessionId = useSessionsStore((state) => state.activeId);
  const messages = useChatStore((state) =>
    sessionId ? state.bySession[sessionId]?.messages : undefined,
  );
  const running = useChatStore((state) =>
    sessionId ? state.bySession[sessionId]?.running : false,
  );
  const [sideHidden, setSideHidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const agents = useMemo(
    () => collectSubagents(messages ?? []),
    [messages],
  );

  // 列表变化时保留仍存在的选中项；没有选中则落到第一个。
  useEffect(() => {
    if (agents.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId && agents.some((agent) => agent.agentId === selectedId)) return;
    setSelectedId(agents[0]!.agentId);
  }, [agents, selectedId]);

  const selected = agents.find((agent) => agent.agentId === selectedId) ?? null;

  return (
    <div className={styles.root}>
      <PageHeader
        title={t.agentsTab}
        sideHidden={sideHidden}
        onToggleSide={() => setSideHidden((current) => !current)}
      />
      <PageSplit
        width={sideWidth}
        onWidthChange={onSideWidthChange}
        minWidth={sideMinWidth}
        maxWidth={sideMaxWidth}
        sidePosition="end"
        sideHidden={sideHidden}
        side={
          <AgentList
            agents={agents}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        }
      >
        {selected ? (
          <SubagentTranscript
            key={selected.agentId}
            agentId={selected.agentId}
            active={running === true}
            variant="page"
          />
        ) : (
          <Empty
            className={styles.empty}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t.agentsEmpty}
          />
        )}
      </PageSplit>
    </div>
  );
}

export default AgentsPage;
