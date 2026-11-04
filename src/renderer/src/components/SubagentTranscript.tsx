import {
  Suspense,
  lazy,
  memo,
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
import { currentBackend } from "@renderer/utils/current-backend";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useSessionsStore } from "@renderer/stores/sessions";
import type { AgentTranscript, AgentTranscriptEntry } from "../../../shared/protocol";
import styles from "./SubagentTranscript.module.css";

const POLL_MS = 1500;
const RETRY_MS = 4000;
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
  const name = entry.kind === "tool" ? entry.toolName : entry.role;
  return `${entry.kind}:${entry.timestamp ?? "none"}:${name}:${index}`;
}

function transcriptSignature(agentId: string, transcript: AgentTranscript | null): string {
  if (!transcript) return `${agentId}:`;
  let pending = 0;
  for (const entry of transcript.messages) {
    if (entry.kind === "tool" && entry.pending) pending += 1;
  }
  const last = transcript.messages[transcript.messages.length - 1];
  return `${agentId}:${transcript.source}:${transcript.truncated ? 1 : 0}:${transcript.messages.length}:${pending}:${last ? JSON.stringify(last) : ""}`;
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
  const pending = entry.pending === true;
  return {
    id,
    role: "tool",
    toolCallId: id,
    toolName: entry.toolName,
    args: argsOf(entry),
    result:
      !pending && (entry.text != null || entry.resultDetails !== undefined)
        ? {
            content: entry.text ? [{ type: "text", text: entry.text }] : [],
            details: entry.resultDetails,
            isError: entry.isError === true,
          }
        : undefined,
    isError: entry.isError,
    ...(pending ? { streaming: true } : {}),
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
  const pending = entry.pending === true;
  return (
    <div className={styles.toolRow}>
      <Suspense fallback={null}>
        <ToolCallCard
          card={toolCardFor(message)}
          toolName={entry.toolName}
          statusLabel={status.label}
          statusType={status.type}
          streaming={pending}
          onOpen={onOpen}
        />
      </Suspense>
    </div>
  );
}

/** 子代理对话：复用主消息区的气泡、Markdown 与工具卡，只是缩在独立小卡片里。 */
export const SubagentTranscript = memo(function SubagentTranscript({
  agentId,
  active,
}: Props): ReactNode {
  const t = useI18n();
  const sessionId = useSessionsStore((state) => state.activeId);
  const filePath = useSessionsStore(
    (state) =>
      state.sessions.find((row) => row.id === state.activeId)?.filePath ?? null,
  );
  const previewStore = usePreviewStore();
  const rightTabs = useRightTabsStore();
  const [open, setOpen] = useState(active);
  const [transcript, setTranscript] = useState<AgentTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const signatureRef = useRef("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(delay: number): void {
      if (active) timer = setTimeout(() => void load(), delay);
    }

    async function load(): Promise<void> {
      if (cancelled) return;
      if (!sessionId) {
        setFailed(true);
        setLoading(false);
        return;
      }
      let ok = true;
      let fromWorker = false;
      let next: AgentTranscript | null = null;
      if (currentBackend() === "omp") {
        try {
          const result = await useSessionsStore.getState().tryCommand(sessionId, {
            type: "get_agent_transcript",
            agentId,
          });
          if (result !== undefined) {
            fromWorker = true;
            next = (result as AgentTranscript | null) ?? null;
          }
        } catch {
          ok = false;
        }
      }
      if (cancelled) return;
      if (!fromWorker) {
        try {
          next = filePath
            ? await window.api.sessions.agentTranscript(filePath, agentId)
            : null;
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (cancelled) return;
      const signature = transcriptSignature(agentId, next);
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setTranscript((prev) => (next === null && prev !== null ? prev : next));
      }
      setFailed(!ok);
      setLoading(false);
      schedule(ok ? POLL_MS : RETRY_MS);
    }

    setLoading(true);
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, agentId, filePath, open, reloadKey, sessionId]);

  useEffect(() => {
    if (!open || !stickToBottom.current) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, transcript]);

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
          ) : null}
          {transcript?.truncated ? (
            <div className={styles.notice}>{t.agentTranscriptTruncated}</div>
          ) : null}
          {transcript && transcript.messages.length > 0
            ? transcript.messages.map((entry, index) => {
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
            : null}
          {!failed && !loading && transcript && transcript.messages.length === 0 ? (
            <div className={styles.empty}>{t.agentTranscriptEmpty}</div>
          ) : null}
          {!failed && !loading && !transcript ? (
            <div className={styles.empty}>{t.agentTranscriptEmpty}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default SubagentTranscript;
