import { useState, type ReactNode } from "react";
import { Button, Input } from "antd";
import {
  BookmarkOutline,
  ChatbubbleOutline,
  CloseCircleOutline,
  GitCommitOutline,
  GitMerge,
  GitPullRequestOutline,
  PersonAddOutline,
  PricetagOutline,
  RefreshOutline,
} from "@renderer/components/icons/ionicons";
import type { IoniconProps } from "@renderer/components/icons/ionicons";
import type {
  PullRequestAction,
  PullRequestDetail,
  PullRequestReview,
  PullRequestTimelineEvent,
} from "../../../shared/github-types";
import GitHubBody from "@renderer/components/GitHubBody";
import GitHubAvatar from "@renderer/components/GitHubAvatar";
import PullRequestCommentCard from "@renderer/components/PullRequestComment";
import {
  formatPullRequestDate,
  formatPullRequestRelative,
  reviewStateLabel,
  timelineEventLabel,
} from "@renderer/utils/pull-request-format";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PullRequestConversation.module.css";

type Props = {
  detail: PullRequestDetail;
  pending: Set<string>;
  onRun?: (action: PullRequestAction) => void;
};

type TimelineIconComponent = (props: IoniconProps) => ReactNode;

function timelineIcon(event: PullRequestTimelineEvent): TimelineIconComponent {
  switch (event.kind) {
    case "committed":
      return GitCommitOutline;
    case "merged":
      return GitMerge;
    case "closed":
      return CloseCircleOutline;
    case "reopened":
      return RefreshOutline;
    case "labeled":
    case "unlabeled":
    case "milestoned":
    case "demilestoned":
      return PricetagOutline;
    case "assigned":
    case "unassigned":
    case "review-requested":
    case "review-request-removed":
      return PersonAddOutline;
    case "ready-for-review":
    case "converted-to-draft":
      return BookmarkOutline;
    default:
      return GitPullRequestOutline;
  }
}

function TimelineIcon({ event, className }: { event: PullRequestTimelineEvent; className?: string }): ReactNode {
  const Icon = timelineIcon(event);
  return <Icon size={13} className={className} />;
}

export function PullRequestConversation({ detail, pending, onRun }: Props): ReactNode {
  const t = useI18n();
  const [commentDraft, setCommentDraft] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");

  const body = detail.body;
  const images = detail.images;

  const conversationComments = detail.comments.filter((comment) => comment.kind === "conversation");
  const reviewBodies = detail.reviews.filter((review) => review.body.trim().length > 0);
  const timeline = detail.timeline;

  function submitComment(): void {
    const value = commentDraft;
    if (!value.trim()) return;
    onRun?.({ kind: "comment", body: value });
    setCommentDraft("");
  }

  function beginEditDescription(): void {
    setDescriptionDraft(body);
    setEditingDescription(true);
  }

  function submitDescription(): void {
    onRun?.({ kind: "edit-description", body: descriptionDraft });
    setEditingDescription(false);
  }

  function forward(action: PullRequestAction): void {
    onRun?.(action);
  }

  function quote(text: string): void {
    const quoted = text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setCommentDraft((current) => (current ? `${current}\n\n${quoted}\n\n` : `${quoted}\n\n`));
  }

  function reviewAvatarLogin(review: PullRequestReview): string {
    return review.author;
  }

  return (
    <div className={styles.conversation}>
      <article className={styles.description}>
        <header className={styles.descriptionHead}>
          <GitHubAvatar login={detail.pullRequest.author ?? "ghost"} avatars={detail.avatars} size="md" />
          <span className={styles.author}>{detail.pullRequest.author || "ghost"}</span>
          <span className={styles.time}>{formatPullRequestDate(detail.pullRequest.createdAt)}</span>
          {detail.viewerCanUpdate && !editingDescription ? (
            <Button size="small" type="text" onClick={beginEditDescription}>
              {t.prEditDescription}
            </Button>
          ) : null}
        </header>
        <div className={styles.descriptionBody}>
          {editingDescription ? (
            <div className={styles.editor}>
              <Input.TextArea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                autoSize={{ minRows: 4, maxRows: 16 }}
              />
              <div className={styles.editorActions}>
                <Button size="small" type="text" onClick={() => setEditingDescription(false)}>
                  {t.cancel}
                </Button>
                <Button size="small" type="primary" onClick={submitDescription}>
                  {t.prSave}
                </Button>
              </div>
            </div>
          ) : (
            <GitHubBody html={body} images={images} empty={t.prNoDescription} />
          )}
        </div>
      </article>

      {reviewBodies.length ? (
        <div>
          {reviewBodies.map((review) => (
            <article key={review.id} className={styles.review}>
              <header>
                <GitHubAvatar login={reviewAvatarLogin(review)} avatars={detail.avatars} size="sm" />
                <span className={styles.author}>{review.author}</span>
                <span className={`${styles.status} ${styles[review.state] ?? ""}`}>{reviewStateLabel(review.state)}</span>
                <span className={styles.time}>{formatPullRequestRelative(review.submittedAt)}</span>
              </header>
              <GitHubBody html={review.body} images={images} />
            </article>
          ))}
        </div>
      ) : null}

      {timeline.length ? (
        <ul className={styles.timeline}>
          {timeline.map((event) => (
            <li key={event.id} className={styles.timelineItem}>
              <TimelineIcon event={event} className={styles.timelineIcon} />
              <span className={styles.timelineText}>
                {event.actor ? <span className={styles.author}>{event.actor}</span> : null}
                {timelineEventLabel(event)}
                {event.subject ? <span className={styles.subject}>{event.subject}</span> : null}
                {event.kind === "renamed" && event.detail ? (
                  <span className={styles.previous}>← {event.detail}</span>
                ) : null}
              </span>
              <span className={styles.time}>{formatPullRequestRelative(event.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.comments}>
        {conversationComments.map((comment) => (
          <PullRequestCommentCard
            key={comment.id}
            comment={comment}
            avatars={detail.avatars}
            images={images}
            pending={pending}
            pendingKey={`edit-comment:${comment.id}`}
            canComment
            onRun={forward}
            onQuote={quote}
          />
        ))}
      </div>

      <div className={styles.composer}>
        <div className={styles.composerHead}>
          <ChatbubbleOutline size={13} />
          <span>{t.prAddComment}</span>
        </div>
        <Input.TextArea
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          placeholder={t.prCommentPlaceholder}
          autoSize={{ minRows: 3, maxRows: 12 }}
        />
        <div className={styles.composerActions}>
          <Button
            size="small"
            type="primary"
            disabled={!commentDraft.trim()}
            loading={pending.has("comment")}
            onClick={submitComment}
          >
            {t.prComment}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default PullRequestConversation;
