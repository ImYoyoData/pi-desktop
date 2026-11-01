import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Typography } from "antd";
import { fontSizeRem } from "../../../shared/appearance";
import type { ChatCompaction, ChatState } from "@renderer/stores/chat-reducer";
import {
  agentOutputSilenceMs,
  agentWaitNetwork,
  agentWaitPhase,
  agentWaitRound,
  agentWaitToolName,
  agentWorkerSilenceMs,
  CONNECT_SLOW_MS,
  formatElapsedShort,
  formatTokenCount,
  httpStatusKind,
} from "@renderer/utils/agent-wait";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { Messages } from "@renderer/i18n";
import styles from "./AgentWaitIndicator.module.css";

type Props = {
  state: Pick<
    ChatState,
    | "running"
    | "streamingMessage"
    | "retryHint"
    | "pendingAskUser"
    | "pendingPermission"
    | "pendingExtensionUi"
    | "turnStartedAt"
    | "phaseStartedAt"
    | "lastActivityAt"
    | "lastWorkerAliveAt"
    | "llmProgress"
    | "llmRound"
    | "nextToolOrder"
    | "compaction"
  > & {
    autoRecovering?: boolean;
  };
};

type Tone = "ok" | "warn" | "danger";

/** 压缩前占用的可读形式：优先百分比，否则 token 数。 */
function compactionSizeText(compaction: ChatCompaction): string {
  const { tokens, contextWindow } = compaction;
  if (tokens && contextWindow && contextWindow > 0) {
    return `${Math.round((tokens / contextWindow) * 100)}%`;
  }
  return tokens ? formatTokenCount(tokens) : "";
}

function compactionReasonLabel(
  reason: ChatCompaction["reason"],
  t: Messages,
): string {
  if (reason === "manual") return t.agentWaitCompactionManual;
  if (reason === "overflow") return t.agentWaitCompactionOverflow;
  if (reason === "threshold") return t.agentWaitCompactionThreshold;
  return "";
}

export function AgentWaitIndicator({ state }: Props): ReactNode {
  const t = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const recovering = Boolean(state.autoRecovering);
  const phase = recovering ? null : agentWaitPhase(state as ChatState);
  const toolName = agentWaitToolName(state as ChatState);
  // 只有卡在「等待模型」或「压缩上下文」时才用网络阶段，已有流时按 thinking/writing 显示。
  const network =
    recovering || (phase !== "waiting_model" && phase !== "compacting")
      ? null
      : agentWaitNetwork(state as ChatState, now);
  const round = agentWaitRound(state as ChatState);
  const compacting = phase === "compacting" ? state.compaction : null;

  const elapsedMs = useMemo(() => {
    const started = state.phaseStartedAt ?? state.turnStartedAt;
    if (!started) return 0;
    return Math.max(0, now - started);
  }, [now, state.phaseStartedAt, state.turnStartedAt]);

  const silenceMs = agentOutputSilenceMs(state as ChatState, now);
  const workerSilenceMs = agentWorkerSilenceMs(state as ChatState, now);

  /** Local worker answered heartbeat recently during this turn. */
  const workerAlive =
    Number.isFinite(workerSilenceMs) && workerSilenceMs < 20_000;

  /** 请求已发出、但迟迟收不到响应头。 */
  const connectSlow =
    network?.stage === "sent" && network.elapsedMs >= CONNECT_SLOW_MS;

  const phaseLabel = (() => {
    if (recovering) return t.autoRecovering;
    if (compacting) return t.agentWaitCompacting;
    if (network) {
      if (network.stage === "sent") {
        return connectSlow
          ? t.agentWaitConnectSlow(
              network.host,
              formatElapsedShort(network.elapsedMs),
            )
          : t.agentWaitRequestSent(network.host);
      }
      if (network.stage === "failed")
        return t.agentWaitRequestFailed(network.host, network.error);
      const kind = httpStatusKind(network.status);
      if (kind === "limited") return t.agentWaitResponseLimited(network.status ?? 0);
      if (kind === "server") return t.agentWaitResponseServer(network.status ?? 0);
      if (kind === "rejected") return t.agentWaitResponseRejected(network.status ?? 0);
      return network.status != null
        ? t.agentWaitResponseHeaders(network.status)
        : t.agentWaitResponseNoStatus;
    }
    switch (phase) {
      case "starting":
        return t.agentWaitStarting;
      case "waiting_model":
        return t.agentWaitModel;
      case "thinking":
        return t.agentWaitThinking;
      case "writing":
        return t.agentWaitWriting;
      case "tool":
        return toolName ? t.agentWaitTool(toolName) : t.agentWaitToolGeneric;
      case "compacting":
        return t.agentWaitCompacting;
      case "waiting_user":
        return t.agentWaitUser;
      case null:
        return t.agentRunning;
      default: {
        const _exhaustive: never = phase;
        return _exhaustive;
      }
    }
  })();

  const detail = (() => {
    if (recovering) return "";
    const elapsed = formatElapsedShort(network?.elapsedMs ?? elapsedMs);
    if (compacting) {
      const parts: string[] = [];
      const reason = compactionReasonLabel(compacting.reason, t);
      if (reason) parts.push(reason);
      const size = compactionSizeText(compacting);
      if (size) parts.push(t.agentWaitCompactionSize(size));
      if (network) {
        parts.push(
          network.stage === "sent"
            ? t.agentWaitCompactionWaitingResponse
            : network.stage === "failed"
              ? t.agentWaitCompactionFailed
              : t.agentWaitCompactionSummarizing,
        );
      }
      parts.push(formatElapsedShort(Math.max(0, now - compacting.startedAt)));
      return parts.join(" · ");
    }
    const silence = silenceMs;
    // Waiting on the user — no hang warning.
    if (phase === "waiting_user") {
      return elapsed;
    }
    if (silence >= 120_000 && !workerAlive) {
      return t.agentWaitLikelyStuck(formatElapsedShort(silence));
    }
    if (silence >= 30_000 && workerAlive) {
      return t.agentWaitSilentAlive(formatElapsedShort(silence), elapsed);
    }
    if (silence >= 45_000) {
      return t.agentWaitSilentUnknown(formatElapsedShort(silence), elapsed);
    }
    if (round) {
      const roundText =
        round.tools > 0
          ? t.agentWaitRoundWithTools(round.round, round.tools)
          : t.agentWaitRoundOnly(round.round);
      return `${roundText} · ${elapsed}`;
    }
    return elapsed;
  })();

  const tone: Tone = useMemo(() => {
    if (recovering) return "warn";
    if (phase === "waiting_user") return "ok";
    if (silenceMs >= 120_000 && !workerAlive) return "danger";
    if (silenceMs >= 30_000 || connectSlow) return "warn";
    return "ok";
  }, [phase, recovering, silenceMs, workerAlive, connectSlow]);

  const toneClass =
    tone === "danger" ? styles.toneDanger : tone === "warn" ? styles.toneWarn : undefined;

  return (
    <div className={`${styles.root}${toneClass ? ` ${toneClass}` : ""}`}>
      <span className={styles.dot} />
      <Typography.Text type="secondary" style={{ fontSize: fontSizeRem(12) }}>
        {phaseLabel}
        {detail ? <span className={styles.detail}> · {detail}</span> : null}
      </Typography.Text>
    </div>
  );
}

export default AgentWaitIndicator;
