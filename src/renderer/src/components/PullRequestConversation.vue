<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NInput, NIcon } from "naive-ui";
import {
  BookmarkOutline,
  GitCommitOutline,
  GitMerge,
  GitPullRequestOutline,
  PersonAddOutline,
  PricetagOutline,
  ChatbubbleOutline,
  CloseCircleOutline,
  RefreshOutline,
} from "@vicons/ionicons5";
import type {
  PullRequestAction,
  PullRequestDetail,
  PullRequestReview,
  PullRequestTimelineEvent,
} from "../../../shared/github-types";
import GitHubBody from "@renderer/components/GitHubBody.vue";
import GitHubAvatar from "@renderer/components/GitHubAvatar.vue";
import PullRequestCommentCard from "@renderer/components/PullRequestComment.vue";
import {
  formatPullRequestDate,
  formatPullRequestRelative,
  reviewStateLabel,
  timelineEventLabel,
} from "@renderer/utils/pull-request-format";
import { t } from "@renderer/i18n";

const props = defineProps<{
  detail: PullRequestDetail;
  pending: Set<string>;
}>();

const emit = defineEmits<{ (event: "run", action: PullRequestAction): void }>();

const commentDraft = ref("");
const editingDescription = ref(false);
const descriptionDraft = ref("");

const body = computed(() => props.detail.body);
const images = computed(() => props.detail.images);

const conversationComments = computed(() =>
  props.detail.comments.filter((comment) => comment.kind === "conversation"),
);

const reviewBodies = computed(() => props.detail.reviews.filter((review) => review.body.trim().length > 0));

const timeline = computed(() => props.detail.timeline);

function submitComment(): void {
  const body = commentDraft.value;
  if (!body.trim()) return;
  emit("run", { kind: "comment", body });
  commentDraft.value = "";
}

function beginEditDescription(): void {
  descriptionDraft.value = body.value;
  editingDescription.value = true;
}

function submitDescription(): void {
  emit("run", { kind: "edit-description", body: descriptionDraft.value });
  editingDescription.value = false;
}

function timelineIcon(event: PullRequestTimelineEvent) {
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

function reviewAvatarLogin(review: PullRequestReview): string {
  return review.author;
}

function forward(action: PullRequestAction): void {
  emit("run", action);
}

function quote(text: string): void {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  commentDraft.value = commentDraft.value ? `${commentDraft.value}\n\n${quoted}\n\n` : `${quoted}\n\n`;
}
</script>

<template>
  <div class="pr-conversation">
    <article class="description">
      <header class="description-head">
        <GitHubAvatar :login="detail.pullRequest.author ?? 'ghost'" :avatars="detail.avatars" size="md" />
        <span class="author">{{ detail.pullRequest.author || "ghost" }}</span>
        <span class="time">{{ formatPullRequestDate(detail.pullRequest.createdAt) }}</span>
        <NButton
          v-if="detail.viewerCanUpdate && !editingDescription"
          size="tiny"
          quaternary
          @click="beginEditDescription"
        >
          {{ t.prEditDescription }}
        </NButton>
      </header>
      <div class="description-body">
        <div v-if="editingDescription" class="editor">
          <NInput v-model:value="descriptionDraft" type="textarea" :autosize="{ minRows: 4, maxRows: 16 }" />
          <div class="editor-actions">
            <NButton size="tiny" quaternary @click="editingDescription = false">{{ t.cancel }}</NButton>
            <NButton size="tiny" type="primary" @click="submitDescription">{{ t.prSave }}</NButton>
          </div>
        </div>
        <GitHubBody v-else :html="body" :images="images" :empty="t.prNoDescription" />
      </div>
    </article>

    <div v-if="reviewBodies.length" class="reviews">
      <article v-for="review in reviewBodies" :key="review.id" class="review">
        <header>
          <GitHubAvatar :login="reviewAvatarLogin(review)" :avatars="detail.avatars" size="sm" />
          <span class="author">{{ review.author }}</span>
          <span class="status" :class="review.state">{{ reviewStateLabel(review.state) }}</span>
          <span class="time">{{ formatPullRequestRelative(review.submittedAt) }}</span>
        </header>
        <GitHubBody :html="review.body" :images="images" />
      </article>
    </div>

    <ul v-if="timeline.length" class="timeline">
      <li v-for="event in timeline" :key="event.id" class="timeline-item">
        <NIcon :component="timelineIcon(event)" :size="13" class="timeline-icon" />
        <span class="timeline-text">
          <span v-if="event.actor" class="author">{{ event.actor }}</span>
          {{ timelineEventLabel(event) }}
          <span v-if="event.subject" class="subject">{{ event.subject }}</span>
          <span v-if="event.kind === 'renamed' && event.detail" class="previous">← {{ event.detail }}</span>
        </span>
        <span class="time">{{ formatPullRequestRelative(event.at) }}</span>
      </li>
    </ul>

    <div class="comments">
      <PullRequestCommentCard
        v-for="comment in conversationComments"
        :key="comment.id"
        :comment="comment"
        :avatars="detail.avatars"
        :images="images"
        :pending="pending"
        :pending-key="`edit-comment:${comment.id}`"
        can-comment
        @run="forward"
        @quote="quote"
      />
    </div>

    <div class="composer">
      <div class="composer-head">
        <NIcon :component="ChatbubbleOutline" :size="13" />
        <span>{{ t.prAddComment }}</span>
      </div>
      <NInput
        v-model:value="commentDraft"
        type="textarea"
        :placeholder="t.prCommentPlaceholder"
        :autosize="{ minRows: 3, maxRows: 12 }"
      />
      <div class="composer-actions">
        <NButton
          size="small"
          type="primary"
          :disabled="!commentDraft.trim()"
          :loading="pending.has('comment')"
          @click="submitComment"
        >
          {{ t.prComment }}
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pr-conversation {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.description,
.review {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(127, 127, 127, 0.025);
  overflow: hidden;
}

.description-head,
.review header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: rgba(127, 127, 127, 0.045);
  font-size: 12px;
}

.description-body {
  padding: 16px 20px;
}

.avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-hover);
  flex: none;
}

.avatar.small {
  width: 18px;
  height: 18px;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 10px;
  color: var(--fg-muted);
}

.author {
  font-weight: 600;
}

.time {
  color: var(--fg-muted);
  margin-left: auto;
}

.status {
  border-radius: 999px;
  padding: 0 6px;
  font-size: 10.5px;
  line-height: 15px;
  background: var(--bg-hover);
  color: var(--fg-muted);
}

.status.approved {
  background: rgba(88, 124, 12, 0.14);
  color: var(--success);
}

.status.changes-requested {
  background: rgba(173, 7, 7, 0.14);
  color: var(--error);
}

.review {
  padding-bottom: 8px;
}

.review > :deep(.github-body) {
  padding: 8px 10px 0;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.editor-actions,
.composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0 0 0 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timeline-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--fg-muted);
}

.timeline-icon {
  flex: none;
  transform: translateY(2px);
}

.timeline-text {
  min-width: 0;
  flex: 1;
}

.timeline-text .subject {
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 11px;
  margin-left: 4px;
}

.timeline-text .previous {
  margin-left: 4px;
  opacity: 0.8;
}

.comments {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  background: rgba(127, 127, 127, 0.025);
}

.composer-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  font-size: 12px;
}
</style>
