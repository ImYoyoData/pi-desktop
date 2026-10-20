import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Typography } from "antd";
import type { ChatState } from "@renderer/stores/chat-reducer";
import {
  agentOutputSilenceMs,
  agentWaitPhase,
  agentWaitToolName,
  agentWorkerSilenceMs,
  formatElapsedShort,
} from "@renderer/utils/agent-wait";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./AgentWaitIndicator.module.css";

type Props = {
  state: Pick<
    ChatState,
    | "running"
    | "streamingMessage"
    | "retryHint"
    | "pendingAskUser"
    | "pendingExtensionUi"
    | "turnStartedAt"
    | "phaseStartedAt"
    | "lastActivityAt"
    | "lastWorkerAliveAt"
  > & {
    autoRecovering?: boolean;
  };
};

type Tone = "ok" | "warn" | "danger";

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

  const phaseLabel = (() => {
    if (recovering) return t.autoRecovering;
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
    const elapsed = formatElapsedShort(elapsedMs);
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
    return elapsed;
  })();

  const tone: Tone = useMemo(() => {
    if (recovering) return "warn";
    if (phase === "waiting_user") return "ok";
    if (silenceMs >= 120_000 && !workerAlive) return "danger";
    if (silenceMs >= 30_000) return "warn";
    return "ok";
  }, [phase, recovering, silenceMs, workerAlive]);

  const toneClass =
    tone === "danger" ? styles.toneDanger : tone === "warn" ? styles.toneWarn : undefined;

  return (
    <div className={`${styles.root}${toneClass ? ` ${toneClass}` : ""}`}>
      <span className={styles.dot} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {phaseLabel}
        {detail ? <span className={styles.detail}> · {detail}</span> : null}
      </Typography.Text>
    </div>
  );
}

export default AgentWaitIndicator;
