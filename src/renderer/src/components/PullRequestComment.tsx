import { useState, type ReactNode } from "react";
import { Button, Input } from "antd";
import {
  ChatbubbleOutline,
  CheckmarkCircleOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  PencilOutline,
  RefreshOutline,
  SyncOutline,
  TextOutline,
  TrashOutline,
} from "@renderer/components/icons/ionicons";
import type {
  PullRequestAction,
  PullRequestComment as PullRequestCommentModel,
  PullRequestReactionContent,
  PullRequestThread,
} from "../../../shared/github-types";
import GitHubBody from "@renderer/components/GitHubBody";
import GitHubAvatar from "@renderer/components/GitHubAvatar";
import { formatPullRequestRelative, REACTION_EMOJI } from "@renderer/utils/pull-request-format";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PullRequestComment.module.css";

type Props = {
  comment: PullRequestCommentModel;
  thread?: PullRequestThread | null;
  replies?: PullRequestCommentModel[];
  avatars?: Record<string, string>;
  images?: Record<string, string>;
  pending?: Set<string>;
  pendingKey?: string;
  replyKey?: string;
  compact?: boolean;
  canComment?: boolean;
  onRun?: (action: PullRequestAction) => void;
  onQuote?: (text: string) => void;
};

const REACTIONS: PullRequestReactionContent[] = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
];

export function PullRequestComment({
  comment,
  thread = null,
  replies = [],
  avatars = {},
  images = {},
  pending = new Set<string>(),
  pendingKey = "",
  replyKey = "",
  compact = false,
  canComment = false,
  onRun,
  onQuote,
}: Props): ReactNode {
  const t = useI18n();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [reactionOpen, setReactionOpen] = useState(false);
  const [hunkOpen, setHunkOpen] = useState(false);
  const [replyListOpen, setReplyListOpen] = useState(true);

  const reactions = comment.reactions ?? [];
  const busy = pendingKey ? pending.has(pendingKey) : false;
  const replyBusy = replyKey ? pending.has(replyKey) : false;
  const resolved = thread?.isResolved === true;

  function beginEdit(): void {
    setEditDraft(comment.body);
    setEditing(true);
  }

  function submitEdit(): void {
    const body = editDraft;
    if (!body.trim()) return;
    onRun?.({ kind: "edit-comment", target: comment.kind, commentId: comment.id, body });
    setEditing(false);
  }

  function removeComment(): void {
    onRun?.({ kind: "delete-comment", target: comment.kind, commentId: comment.id });
  }

  function submitReply(): void {
    const body = replyDraft;
    if (!body.trim()) return;
    onRun?.({ kind: "reply", commentId: comment.id, body });
    setReplyDraft("");
    setReplying(false);
  }

  function toggleReaction(content: PullRequestReactionContent, reacted: boolean): void {
    const subjectId = comment.nodeId ?? "";
    if (!subjectId) return;
    onRun?.({ kind: "react", subjectId, content, add: !reacted });
    setReactionOpen(false);
  }

  function toggleThread(): void {
    const target = thread;
    if (!target || busy) return;
    onRun?.({ kind: "resolve-thread", threadId: target.id, resolved: !target.isResolved });
  }

  return (
    <article className={[styles.comment, compact && styles.compact, resolved && styles.resolved].filter(Boolean).join(" ")}>
      <GitHubAvatar login={comment.author || "ghost"} avatars={avatars} size={compact ? "sm" : "md"} />
      <div className={styles.body}>
        <header className={styles.meta}>
          <span className={styles.author}>{comment.author || "ghost"}</span>
          <span className={styles.time}>{formatPullRequestRelative(comment.createdAt)}</span>
          {comment.outdated ? <span className={styles.tag}>{t.prOutdated}</span> : null}
          {resolved && !compact ? (
            <span className={`${styles.tag} ${styles.resolvedTag}`}>
              <CheckmarkCircleOutline size={11} />
              {t.prResolved}
            </span>
          ) : null}
        </header>

        {comment.diffHunk && !compact ? (
          <button
            type="button"
            className={styles.hunkToggle}
            onClick={() => setHunkOpen((current) => !current)}
          >
            {hunkOpen ? <ChevronDownOutline size={11} /> : <ChevronForwardOutline size={11} />}
            <span>{comment.path}</span>
            {comment.line ? <span>:{comment.line}</span> : null}
          </button>
        ) : null}
        {comment.diffHunk && hunkOpen && !compact ? <pre className={styles.hunk}>{comment.diffHunk}</pre> : null}

        {!editing ? (
          <div className={styles.content}>
            <GitHubBody html={comment.body} images={images} empty={t.prNoDescription} />
          </div>
        ) : (
          <div className={styles.editor}>
            <Input.TextArea
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              autoSize={{ minRows: 3, maxRows: 12 }}
            />
            <div className={styles.editorActions}>
              <Button size="small" type="text" onClick={() => setEditing(false)}>
                {t.cancel}
              </Button>
              <Button size="small" type="primary" disabled={!editDraft.trim()} loading={busy} onClick={submitEdit}>
                {t.prSave}
              </Button>
            </div>
          </div>
        )}

        <footer className={styles.actions}>
          {reactions.map((reaction) => (
            <button
              key={reaction.content}
              type="button"
              className={`${styles.reaction} ${reaction.viewerHasReacted ? styles.mine : ""}`}
              title={reaction.content}
              onClick={() => toggleReaction(reaction.content, reaction.viewerHasReacted)}
            >
              <span>{REACTION_EMOJI[reaction.content]}</span>
              <span>{reaction.count}</span>
            </button>
          ))}

          <span className={styles.spacer} />

          <div className={styles.menuWrap}>
            <button
              type="button"
              className={styles.actionBtn}
              title={t.prComment}
              onClick={() => setReactionOpen((current) => !current)}
            >
              <SyncOutline size={12} />
            </button>
            {reactionOpen ? (
              <div className={styles.reactionMenu}>
                {REACTIONS.map((content) => (
                  <button
                    key={content}
                    type="button"
                    className={styles.reactionChoice}
                    onClick={() =>
                      toggleReaction(
                        content,
                        reactions.some((entry) => entry.content === content && entry.viewerHasReacted),
                      )
                    }
                  >
                    {REACTION_EMOJI[content]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {comment.viewerCanUpdate ? (
            <button type="button" className={styles.actionBtn} title={t.prEdit} onClick={beginEdit}>
              <PencilOutline size={12} />
            </button>
          ) : null}
          {!compact ? (
            <button
              type="button"
              className={styles.actionBtn}
              title={t.prReply.replace("…", "")}
              onClick={() => onQuote?.(comment.body)}
            >
              <TextOutline size={12} />
            </button>
          ) : null}
          {comment.viewerCanDelete ? (
            <button type="button" className={`${styles.actionBtn} ${styles.danger}`} title={t.prDelete} onClick={removeComment}>
              <TrashOutline size={12} />
            </button>
          ) : null}
          {comment.kind === "review" && canComment ? (
            <button
              type="button"
              className={styles.actionBtn}
              title={t.prReply}
              onClick={() => setReplying((current) => !current)}
            >
              <ChatbubbleOutline size={12} />
            </button>
          ) : null}
          {thread && !compact && (thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve) ? (
            <button
              type="button"
              className={styles.actionBtn}
              title={thread.isResolved ? t.prUnresolveConversation : t.prResolveConversation}
              disabled={busy}
              onClick={toggleThread}
            >
              <RefreshOutline size={12} />
            </button>
          ) : null}
        </footer>

        {comment.kind === "review" && replies.length ? (
          <div className={styles.replies}>
            <button type="button" className={styles.repliesToggle} onClick={() => setReplyListOpen((current) => !current)}>
              {replyListOpen ? <ChevronDownOutline size={11} /> : <ChevronForwardOutline size={11} />}
              <span>{replies.length}</span>
            </button>
            <div className={styles.replyList} style={replyListOpen ? undefined : { display: "none" }}>
              {replies.map((reply) => (
                <PullRequestComment
                  key={reply.id}
                  comment={reply}
                  avatars={avatars}
                  images={images}
                  pending={pending}
                  pendingKey={`edit-comment:${reply.id}`}
                  canComment={canComment}
                  compact
                  onRun={onRun}
                />
              ))}
            </div>
          </div>
        ) : null}

        {replying ? (
          <div className={styles.editor}>
            <Input.TextArea
              value={replyDraft}
              onChange={(event) => setReplyDraft(event.target.value)}
              placeholder={t.prReplyPlaceholder}
              autoSize={{ minRows: 2, maxRows: 8 }}
            />
            <div className={styles.editorActions}>
              <Button size="small" type="text" onClick={() => setReplying(false)}>
                {t.cancel}
              </Button>
              <Button size="small" type="primary" disabled={!replyDraft.trim()} loading={replyBusy} onClick={submitReply}>
                {t.prReply.replace("…", "")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default PullRequestComment;
