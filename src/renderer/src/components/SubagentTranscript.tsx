import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronForwardOutline } from "@renderer/components/icons/ionicons";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { Messages } from "@renderer/i18n";
import { useSessionsStore } from "@renderer/stores/sessions";
import type { AgentTranscript, AgentTranscriptEntry } from "../../../shared/protocol";
import styles from "./SubagentTranscript.module.css";

const POLL_MS = 1500;

type Props = {
  agentId: string;
  /** 子代理仍在运行：展开后持续刷新。 */
  active: boolean;
};

function TranscriptEntry({
  entry,
  t,
}: {
  entry: AgentTranscriptEntry;
  t: Messages;
}): ReactNode {
  if (entry.kind === "tool") {
    return (
      <div className={`${styles.entry} ${styles.tool}`}>
        <div className={styles.toolHead}>
          <span className={styles.toolName}>{entry.toolName}</span>
          {entry.isError ? (
            <span className={styles.toolError}>{t.agentTranscriptError}</span>
          ) : null}
        </div>
        {entry.args ? <pre className={styles.args}>{entry.args}</pre> : null}
        {entry.text ? (
          <pre className={entry.isError ? styles.toolErrorText : styles.toolText}>
            {entry.text}
          </pre>
        ) : null}
      </div>
    );
  }
  const isUser = entry.role === "user";
  return (
    <div className={`${styles.entry} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.role}>
        {isUser ? t.agentTranscriptUser : t.agentTranscriptAssistant}
      </div>
      {entry.thinking ? (
        <details className={styles.thinking}>
          <summary>{t.agentTranscriptThinking}</summary>
          <pre>{entry.thinking}</pre>
        </details>
      ) : null}
      {entry.text ? <pre className={styles.text}>{entry.text}</pre> : null}
    </div>
  );
}

/** 子代理对话：独立卡片，展开后按需读取并在运行期间轮询。 */
export function SubagentTranscript({ agentId, active }: Props): ReactNode {
  const t = useI18n();
  const sessionId = useSessionsStore((state) => state.activeId);
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<AgentTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load(): Promise<void> {
      if (!sessionId) {
        setFailed(true);
        setLoading(false);
        return;
      }
      let ok = true;
      try {
        const result = await useSessionsStore.getState().sendCommand(sessionId, {
          type: "get_agent_transcript",
          agentId,
        });
        if (cancelled) return;
        setTranscript((result as AgentTranscript | null) ?? null);
        setFailed(false);
      } catch {
        ok = false;
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (active && ok) timer = setTimeout(load, POLL_MS);
        }
      }
    }

    setLoading(true);
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, agentId, open, reloadKey, sessionId]);

  useEffect(() => {
    if (!open || !active) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active, open, transcript]);

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronForwardOutline
          size={11}
          className={`${styles.chev}${open ? ` ${styles.chevOpen}` : ""}`}
        />
        <span>{open ? t.agentTranscriptHide : t.agentTranscriptShow}</span>
        {transcript ? (
          <span className={styles.count}>
            {t.agentTranscriptCount(transcript.messages.length)}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={styles.body} ref={bodyRef} data-inner-scroll="">
          {failed ? (
            <div className={styles.empty}>
              <span>{t.agentTranscriptFailed}</span>
              <button
                type="button"
                className={styles.retry}
                onClick={() => setReloadKey((value) => value + 1)}
              >
                {t.agentTranscriptRetry}
              </button>
            </div>
          ) : loading && !transcript ? (
            <div className={styles.empty}>{t.agentTranscriptLoading}</div>
          ) : !transcript || transcript.messages.length === 0 ? (
            <div className={styles.empty}>{t.agentTranscriptEmpty}</div>
          ) : (
            transcript?.messages.map((entry, index) => (
              <TranscriptEntry key={index} entry={entry} t={t} />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default SubagentTranscript;
