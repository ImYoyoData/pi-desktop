import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Button, Image, Tag, Typography } from "antd";
import { fontSizeRem } from "../../../../shared/appearance";
import {
  ArrowUndoOutline,
  BrainOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  ChevronUpOutline,
  CopyOutline,
  CreateOutline,
  GitBranchOutline,
  RefreshOutline,
} from "@renderer/components/icons/ionicons";
import type { ChatLlmProgress, ChatMessage, ChatRetryHint } from "@renderer/stores/chat";
import ThinkingBlock from "@renderer/components/ThinkingBlock";
import ToolCallCard from "@renderer/components/ToolCallCard";
import AskUserStrip from "@renderer/components/AskUserStrip";
import TurnDiffSummary from "@renderer/components/TurnDiffSummary";
import { MarkdownView } from "./lazy-markdown";
import { clipRequestError, formatElapsedShort, formatTokenCount } from "@renderer/utils/agent-wait";
import type { UserRowView } from "@renderer/utils/message-user";
import type { CompactDetail, ToolMessage, ToolStatusLabel } from "@renderer/utils/message-metrics";
import type { ToolCard } from "@renderer/utils/tool-diff";
import type { TurnFileChanges } from "@renderer/utils/turn-file-changes";
import type { useI18n } from "@renderer/i18n/use-i18n";
import styles from "../MessageList.module.css";

type Translator = ReturnType<typeof useI18n>;

function SendReceipt({ read }: { read: boolean }): ReactElement {
  const paths = read
    ? ["M1 6.6 4.1 9.8 9.5 2.6", "M6.2 6.6 9.3 9.8 14.7 2.6"]
    : ["M3.5 6.6 6.6 9.8 12 2.6"];
  return (
    <svg viewBox="0 0 16 12" width={16} height={12} fill="none" aria-hidden="true">
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/**
 * 用户气泡正文：长卡片才折叠四行，并测量是否真的溢出。
 * 折叠由字符阈值决定，展开入口由实际渲染高度决定，避免短消息被静默截断。
 */
function UserPlainText({
  id,
  text,
  collapsed,
  onOverflowChange,
}: {
  id: string;
  text: string;
  collapsed: boolean;
  onOverflowChange: (id: string, overflowing: boolean) => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !collapsed) return;
    const measure = (): void => {
      onOverflowChange(id, el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, text, collapsed, onOverflowChange]);

  return (
    <div
      ref={ref}
      className={`${styles.userPlain}${collapsed ? ` ${styles.clamped}` : ""}`}
    >
      {text}
    </div>
  );
}

type UserMessageRowProps = {
  msg: Extract<ChatMessage, { role: "user" }>;
  rowClass: string;
  view: UserRowView;
  expanded: boolean;
  overflowing: boolean;
  latest: boolean;
  latestRead: boolean;
  running: boolean;
  canRevert: boolean;
  reverted: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRevert: () => void;
  onToggleExpand: () => void;
  onOverflowChange: (id: string, overflowing: boolean) => void;
  t: Translator;
};

export function UserMessageRow({
  msg,
  rowClass,
  view,
  expanded,
  overflowing,
  latest,
  latestRead,
  running,
  canRevert,
  reverted,
  onCopy,
  onEdit,
  onRevert,
  onToggleExpand,
  onOverflowChange,
  t,
}: UserMessageRowProps): ReactElement {
  return (
    <article className={rowClass} data-msg-id={msg.id}>
      <div className={`${styles.bubbleWrap} ${styles.user}`}>
        <div className={`${styles.bubble} ${styles.user}`}>
          {msg.images?.length ? (
            <div className={styles.userImages}>
              {msg.images.map((img, idx) => (
                <Image
                  key={`${msg.id}-img-${idx}`}
                  className={styles.userImage}
                  src={img.dataUrl}
                  alt={t.imageAttachment}
                  styles={{
                    root: {
                      width: 72,
                      height: 72,
                      borderRadius: 4,
                      overflow: "hidden",
                      border: "1px solid var(--border)",
                    },
                    image: { width: "100%", height: "100%", objectFit: "cover" },
                  }}
                />
              ))}
            </div>
          ) : null}
          {view.text ? (
            <UserPlainText
              id={msg.id}
              text={view.text}
              collapsed={!expanded && view.needsToggle}
              onOverflowChange={onOverflowChange}
            />
          ) : null}
          {view.tags.length ? (
            <div className={styles.userTags}>
              {view.tags.map((tag, idx) => (
                <Tag
                  key={`${msg.id}-tag-${idx}`}
                  color="blue"
                  className={`${styles.userTag}${tag.kind === "file" ? ` ${styles.userTagFile}` : ""}`}
                  title={tag.url || tag.label}
                >
                  {tag.label || tag.content}
                </Tag>
              ))}
            </div>
          ) : null}
          {canRevert || reverted ? (
            <div className={styles.userBubbleFooter}>
              <button
                type="button"
                className={styles.bubbleRevert}
                disabled={running || reverted}
                aria-label={reverted ? t.reverted : t.revertTurn}
                onClick={(event) => {
                  event.stopPropagation();
                  onRevert();
                }}
              >
                <ArrowUndoOutline size={15} />
              </button>
            </div>
          ) : null}
          {view.needsToggle && overflowing ? (
            <button
              type="button"
              className={styles.userCardToggle}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
            >
              {expanded ? (
                <ChevronUpOutline size={13} />
              ) : (
                <ChevronDownOutline size={13} />
              )}
              <span>{expanded ? t.userCardCollapse : t.userCardExpand}</span>
            </button>
          ) : null}
        </div>
        <div className={`${styles.actions} ${styles.userActions}`}>
          {latest ? (
            <span
              className={styles.userReceipt}
              title={latestRead ? t.receiptRead : t.receiptSent}
              aria-label={latestRead ? t.receiptRead : t.receiptSent}
            >
              <SendReceipt read={latestRead} />
            </span>
          ) : null}
          <Button
            type="text"
            shape="circle"
            size="small"
            icon={<CopyOutline />}
            onClick={onCopy}
          />
          <Button
            type="text"
            shape="circle"
            size="small"
            icon={<CreateOutline />}
            onClick={onEdit}
          />
        </div>
      </div>
    </article>
  );
}

type AssistantMessageRowProps = {
  msg: Extract<ChatMessage, { role: "assistant" }>;
  rowClass: string;
  stats: CompactDetail | null | undefined;
  modelDetail: CompactDetail | null | undefined;
  diff: TurnFileChanges | null;
  canShowActions: boolean;
  isLatestRound: boolean;
  hasRoundUser: boolean;
  diffOpen: boolean;
  autoExpandSummary: boolean;
  turnDone: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onRestore: () => void;
  onFork: () => void;
  onToggleDiff: () => void;
  onOpenFile: (filePath: string) => void;
};

export function AssistantMessageRow({
  msg,
  rowClass,
  stats,
  modelDetail,
  diff,
  canShowActions,
  isLatestRound,
  hasRoundUser,
  diffOpen,
  autoExpandSummary,
  turnDone,
  onCopy,
  onRegenerate,
  onRestore,
  onFork,
  onToggleDiff,
  onOpenFile,
}: AssistantMessageRowProps): ReactElement {
  return (
    <article className={rowClass} data-msg-id={msg.id}>
      {msg.text || msg.thinking || !msg.streaming ? (
        <div className={`${styles.bubbleWrap} ${styles.assistant}`}>
          <div
            className={`${styles.bubble} ${styles.assistant}${
              msg.streaming && msg.thinking && !msg.text ? ` ${styles.thinkBottom}` : ""
            }`}
          >
            {msg.thinking || (msg.streaming && !msg.text) ? (
              <ThinkingBlock
                thinking={msg.thinking ?? ""}
                streaming={Boolean(msg.streaming && !msg.text)}
                autoCollapse={turnDone || !(msg.streaming && !msg.text)}
                autoExpand={autoExpandSummary}
                leadingIcon={<BrainOutline size={13} aria-hidden="true" />}
                durationMs={msg.thinkingDurationMs}
                startedAt={msg.thinkingStartedAt}
              />
            ) : null}
            {msg.text ? (
              <Suspense fallback={null}>
                <MarkdownView
                  content={msg.text}
                  streaming={Boolean(msg.streaming)}
                  variant="chat"
                  className={`assistant-md${
                    msg.streaming && msg.text ? ` ${styles.streamShimmer}` : ""
                  }`}
                />
              </Suspense>
            ) : null}
            {msg.streaming && msg.text ? (
              <span className={styles.cursor} aria-hidden="true" />
            ) : null}
          </div>
          {canShowActions ? (
            <div className={styles.actions}>
              <Button
                type="text"
                shape="circle"
                size="small"
                icon={<CopyOutline />}
                onClick={onCopy}
              />
              <Button
                type="text"
                shape="circle"
                size="small"
                icon={<RefreshOutline />}
                onClick={onRegenerate}
              />
              {hasRoundUser ? (
                <>
                  {!isLatestRound ? (
                    <Button
                      type="text"
                      shape="circle"
                      size="small"
                      icon={<ArrowUndoOutline />}
                      onClick={onRestore}
                    />
                  ) : null}
                  <Button
                    type="text"
                    shape="circle"
                    size="small"
                    icon={<GitBranchOutline />}
                    onClick={onFork}
                  />
                </>
              ) : null}
              {stats ? (
                <span className={styles.assistantStats} title={stats.detail}>
                  {stats.compact}
                </span>
              ) : null}
              {modelDetail ? (
                <span className={styles.assistantModel} title={modelDetail.detail}>
                  {modelDetail.compact}
                </span>
              ) : null}
            </div>
          ) : null}

          {diff ? (
            <TurnDiffSummary
              changes={diff}
              open={diffOpen}
              onToggle={onToggleDiff}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

type ToolMessageRowProps = {
  msg: ToolMessage;
  rowClass: string;
  pendingAsk: boolean;
  card: ToolCard;
  toolName: string;
  status: ToolStatusLabel;
  settled: boolean;
  onOpen: (filePath: string) => void;
};

export function ToolMessageRow({
  msg,
  rowClass,
  pendingAsk,
  card,
  toolName,
  status,
  settled,
  onOpen,
}: ToolMessageRowProps): ReactElement {
  if (pendingAsk) {
    return (
      <article className={rowClass} data-msg-id={msg.id}>
        <div className={styles.tool}>
          <AskUserStrip />
        </div>
      </article>
    );
  }
  return (
    <article className={rowClass} data-msg-id={msg.id}>
      <div className={styles.tool}>
        <ToolCallCard
          card={card}
          toolName={toolName}
          statusLabel={status.label}
          statusType={status.type}
          streaming={msg.streaming}
          autoCollapse={settled}
          nestedCalls={msg.nestedCalls}
          onOpen={onOpen}
        />
      </div>
    </article>
  );
}

type SummaryMessageRowProps = {
  msg: Extract<ChatMessage, { role: "summary" }>;
  rowClass: string;
  open: boolean;
  onToggle: () => void;
  t: Translator;
};

export function SummaryMessageRow({
  msg,
  rowClass,
  open,
  onToggle,
  t,
}: SummaryMessageRowProps): ReactElement {
  const rollover = msg.rollover === true;
  const meta = [
    msg.tokensBefore
      ? rollover
        ? t.summaryRolloverTokens(msg.tokensBefore)
        : t.summaryTokens(msg.tokensBefore)
      : "",
    msg.durationMs ? t.summaryDuration(formatElapsedShort(msg.durationMs)) : "",
    msg.summaryTokens ? t.summaryCost(formatTokenCount(msg.summaryTokens)) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className={rowClass} data-msg-id={msg.id}>
      <div className={styles.summaryCard}>
        <button
          className={styles.summaryHead}
          type="button"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? <ChevronDownOutline /> : <ChevronForwardOutline />}
          <span className={styles.summaryTitle}>
            {rollover
              ? t.summaryRollover
              : msg.kind === "compaction"
                ? t.summaryCompaction
                : t.summaryBranch}
          </span>
          {meta ? <span className={styles.summaryMeta}>{meta}</span> : null}
        </button>
        {open ? (
          <div className={styles.summaryBody}>
            {rollover ? t.summaryRolloverNote : msg.text}
          </div>
        ) : null}
      </div>
    </article>
  );
}

type ErrorMessageRowProps = {
  msg: Extract<ChatMessage, { role: "error" }>;
  rowClass: string;
  running: boolean;
  onRetry: () => void;
  t: Translator;
};

export function ErrorMessageRow({
  msg,
  rowClass,
  running,
  onRetry,
  t,
}: ErrorMessageRowProps): ReactElement {
  const cancelled = msg.variant === "cancelled";
  return (
    <article className={rowClass} data-msg-id={msg.id}>
      <div
        className={`${styles.bubbleWrap} ${cancelled ? styles.cancelledWrap : styles.errorWrap}`}
      >
        <div
          className={`${styles.bubble} ${cancelled ? styles.cancelled : styles.error}`}
        >
          {msg.text}
        </div>
        <Button
          size="small"
          type={cancelled ? "text" : "primary"}
          danger={!cancelled}
          disabled={running}
          className={styles.errorRetryBtn}
          icon={<RefreshOutline />}
          onClick={onRetry}
        >
          {t.retryRequest}
        </Button>
      </div>
    </article>
  );
}

/** 自动重试行：重试倒计时 + 重试请求已发出时的网络阶段。 */
export function RetryHintRow({
  hint,
  progress,
  t,
}: {
  hint: ChatRetryHint;
  progress: ChatLlmProgress | null;
  t: Translator;
}): ReactElement {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const sent = progress != null && progress.startedAt >= hint.at;
  const remaining = Math.max(
    0,
    Math.ceil((hint.delayMs - (now - hint.at)) / 1000),
  );
  const detail = (() => {
    if (sent && progress) {
      if (progress.stage === "failed")
        return t.agentWaitRequestFailed(
          progress.host,
          progress.error ? clipRequestError(progress.error) : undefined,
        );
      if (progress.stage === "response") {
        return progress.status != null
          ? t.agentWaitResponseHeaders(progress.status)
          : t.agentWaitResponseNoStatus;
      }
      return t.agentWaitRequestSent(progress.host);
    }
    return remaining > 0 ? t.agentWaitRetryCountdown(remaining) : "";
  })();

  return (
    <div className={styles.runningIndicator}>
      <span className={`${styles.dot} ${styles.warn}`} />
      <Typography.Text type="secondary" style={{ fontSize: fontSizeRem(12) }}>
        {t.retrying(hint.attempt, hint.maxAttempts)}
        {detail ? <span className={styles.retryDetail}> · {detail}</span> : null}
        {hint.message ? (
          <span className={styles.retryDetail}> · {hint.message}</span>
        ) : null}
      </Typography.Text>
    </div>
  );
}
