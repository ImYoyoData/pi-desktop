import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BrainOutline, ChevronForwardOutline } from "@renderer/components/icons/ionicons";
import ThinkingBlock from "@renderer/components/ThinkingBlock";
import { useI18n } from "@renderer/i18n/use-i18n";
import { toolStatus, type ToolMessage } from "@renderer/utils/message-metrics";
import { toolCardFor } from "@renderer/utils/tool-diff";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useSessionsStore } from "@renderer/stores/sessions";
import type { AgentTranscript, AgentTranscriptEntry } from "../../../shared/protocol";
import styles from "./SubagentTranscript.module.css";

const POLL_MS = 1500;
const NEAR_BOTTOM_PX = 40;

const MarkdownView = lazy(() => import("@renderer/components/MarkdownView"));
const ToolCallCard = lazy(() => import("@renderer/components/ToolCallCard"));

type Props = {
  agentId: string;
  /** 子代理仍在运行：展开后持续刷新。 */
  active: boolean;
};

type ToolEntry = Extract<AgentTranscriptEntry, { kind: "tool" }>;

function entryKey(entry: AgentTranscriptEntry, index: number): string {
  if (entry.kind === "tool" && entry.callId) return `tool:${entry.callId}`;
  if (entry.timestamp != null) {
    const name = entry.kind === "tool" ? entry.toolName : entry.role;
    return `${entry.kind}:${entry.timestamp}:${name}`;
  }
  return `${entry.kind}:${index}`;
}

function argsOf(entry: ToolEntry): unknown {
  if (entry.argsValue !== undefined) return entry.argsValue;
  if (!entry.args) return undefined;
  try {
    return JSON.parse(entry.args);
  } catch {
    return entry.args;
  }
}

function toolMessageOf(entry: ToolEntry, agentId: string, key: string): ToolMessage {
  const id = `${agentId}:${key}`;
  return {
    id,
    role: "tool",
    toolCallId: id,
    toolName: entry.toolName,
    args: argsOf(entry),
    result:
      entry.text != null || entry.resultDetails !== undefined
        ? {
            content: entry.text ? [{ type: "text", text: entry.text }] : [],
            details: entry.resultDetails,
            isError: entry.isError === true,
          }
        : undefined,
    isError: entry.isError,
  };
}

function ToolEntryView({
  entry,
  agentId,
  entryKey: key,
  onOpen,
}: {
  entry: ToolEntry;
  agentId: string;
  entryKey: string;
  onOpen: (path: string) => void;
}): ReactNode {
  const message = useMemo(
    () => toolMessageOf(entry, agentId, key),
    [agentId, entry, key],
  );
  const status = toolStatus(message);
  return (
    <div className={styles.toolRow}>
      <Suspense fallback={null}>
        <ToolCallCard
          card={toolCardFor(message)}
          toolName={entry.toolName}
          statusLabel={status.label}
          statusType={status.type}
          onOpen={onOpen}
        />
      </Suspense>
    </div>
  );
}

/** 子代理对话：复用主消息区的气泡、Markdown 与工具卡，只是缩在独立小卡片里。 */
export function SubagentTranscript({ agentId, active }: Props): ReactNode {
  const t = useI18n();
  const sessionId = useSessionsStore((state) => state.activeId);
  const previewStore = usePreviewStore();
  const rightTabs = useRightTabsStore();
  const [open, setOpen] = useState(true);
  const [transcript, setTranscript] = useState<AgentTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

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
    if (!open || !active || !stickToBottom.current) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active, open, transcript]);

  function openPreview(path: string): void {
    previewStore.openPreview(path);
    rightTabs.addTab("preview", {
      filePath: path,
      label: path.split(/[/\\]/).pop() ?? t.preview,
    });
  }

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
        <div
          className={styles.body}
          ref={bodyRef}
          data-inner-scroll=""
          onScroll={(event) => {
            const el = event.currentTarget;
            stickToBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          }}
        >
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
            transcript.messages.map((entry, index) => {
              const key = entryKey(entry, index);
              if (entry.kind === "tool") {
                return (
                  <ToolEntryView
                    key={key}
                    entry={entry}
                    agentId={agentId}
                    entryKey={key}
                    onOpen={openPreview}
                  />
                );
              }
              if (entry.role === "user") {
                return (
                  <div key={key} className={styles.userRow}>
                    <div className={styles.userBubble}>{entry.text}</div>
                  </div>
                );
              }
              return (
                <div key={key} className={styles.assistantRow}>
                  {entry.thinking ? (
                    <ThinkingBlock
                      thinking={entry.thinking}
                      autoCollapse
                      leadingIcon={<BrainOutline size={13} aria-hidden="true" />}
                    />
                  ) : null}
                  {entry.text ? (
                    <Suspense fallback={<pre className={styles.plain}>{entry.text}</pre>}>
                      <MarkdownView
                        content={entry.text}
                        variant="chat"
                        className="assistant-md"
                      />
                    </Suspense>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default SubagentTranscript;
