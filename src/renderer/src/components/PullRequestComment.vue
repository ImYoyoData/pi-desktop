<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { NButton, NIcon, NInput } from "naive-ui";
import {
  CheckmarkCircleOutline,
  ChatbubbleOutline,
  CreateOutline,
  RefreshOutline,
  TextOutline,
  TrashOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  SyncOutline,
} from "@vicons/ionicons5";
import type {
  PullRequestAction,
  PullRequestComment,
  PullRequestReactionContent,
  PullRequestThread,
} from "../../../shared/github-types";
import GitHubBody from "@renderer/components/GitHubBody.vue";
import GitHubAvatar from "@renderer/components/GitHubAvatar.vue";
import { formatPullRequestRelative, REACTION_EMOJI } from "@renderer/utils/pull-request-format";
import { t } from "@renderer/i18n";

const props = withDefaults(
  defineProps<{
    comment: PullRequestComment;
    thread?: PullRequestThread | null;
    replies?: PullRequestComment[];
    avatars?: Record<string, string>;
    images?: Record<string, string>;
    pending?: Set<string>;
    pendingKey?: string;
    replyKey?: string;
    compact?: boolean;
    canComment?: boolean;
  }>(),
  {
    thread: null,
    replies: () => [],
    avatars: () => ({}),
    images: () => ({}),
    pending: () => new Set(),
    pendingKey: "",
    replyKey: "",
    compact: false,
    canComment: false,
  },
);

const emit = defineEmits<{
  (event: "run", action: PullRequestAction): void;
  (event: "quote", text: string): void;
}>();

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

const editing = ref(false);
const editDraft = ref("");
const replying = ref(false);
const replyDraft = ref("");
const reactionOpen = ref(false);
const hunkOpen = ref(false);
const replyListOpen = ref(true);

const reactions = computed(() => props.comment.reactions ?? []);
const busy = computed(() => (props.pendingKey ? props.pending.has(props.pendingKey) : false));
const replyBusy = computed(() => (props.replyKey ? props.pending.has(props.replyKey) : false));
const thread = computed(() => props.thread ?? null);
const resolved = computed(() => thread.value?.isResolved === true);

function beginEdit(): void {
  editDraft.value = props.comment.body;
  editing.value = true;
  void nextTick(() => undefined);
}

function submitEdit(): void {
  const body = editDraft.value;
  if (!body.trim()) return;
  emit("run", { kind: "edit-comment", target: props.comment.kind, commentId: props.comment.id, body });
  editing.value = false;
}

function removeComment(): void {
  emit("run", { kind: "delete-comment", target: props.comment.kind, commentId: props.comment.id });
}

function submitReply(): void {
  const body = replyDraft.value;
  if (!body.trim()) return;
  emit("run", { kind: "reply", commentId: props.comment.id, body });
  replyDraft.value = "";
  replying.value = false;
}

function toggleReaction(content: PullRequestReactionContent, reacted: boolean): void {
  const subjectId = props.comment.nodeId ?? "";
  if (!subjectId) return;
  emit("run", { kind: "react", subjectId, content, add: !reacted });
  reactionOpen.value = false;
}

function toggleThread(): void {
  const target = thread.value;
  if (!target || busy.value) return;
  emit("run", { kind: "resolve-thread", threadId: target.id, resolved: !target.isResolved });
}
</script>

<template>
  <article class="pr-comment" :class="{ compact, resolved }">
    <GitHubAvatar :login="comment.author || 'ghost'" :avatars="avatars" :size="compact ? 'sm' : 'md'" />
    <div class="body">
      <header class="meta">
        <span class="author">{{ comment.author || "ghost" }}</span>
        <span class="time">{{ formatPullRequestRelative(comment.createdAt) }}</span>
        <span v-if="comment.outdated" class="tag">{{ t.prOutdated }}</span>
        <span v-if="resolved && !compact" class="tag resolved-tag">
          <NIcon :component="CheckmarkCircleOutline" :size="11" />{{ t.prResolved }}
        </span>
      </header>

      <button
        v-if="comment.diffHunk && !compact"
        type="button"
        class="hunk-toggle"
        @click="hunkOpen = !hunkOpen"
      >
        <NIcon :component="hunkOpen ? ChevronDownOutline : ChevronForwardOutline" :size="11" />
        <span>{{ comment.path }}</span>
        <span v-if="comment.line" class="hunk-line">:{{ comment.line }}</span>
      </button>
      <pre v-if="comment.diffHunk && hunkOpen && !compact" class="hunk">{{ comment.diffHunk }}</pre>

      <div v-if="!editing" class="content">
        <GitHubBody :html="comment.body" :images="images" :empty="t.prNoDescription" />
      </div>
      <div v-else class="editor">
        <NInput v-model:value="editDraft" type="textarea" :autosize="{ minRows: 3, maxRows: 12 }" />
        <div class="editor-actions">
          <NButton size="tiny" quaternary @click="editing = false">{{ t.cancel }}</NButton>
          <NButton size="tiny" type="primary" :disabled="!editDraft.trim()" :loading="busy" @click="submitEdit">
            {{ t.prSave }}
          </NButton>
        </div>
      </div>

      <footer class="actions">
        <button
          v-if="reactions.length"
          v-for="reaction in reactions"
          :key="reaction.content"
          type="button"
          class="reaction"
          :class="{ mine: reaction.viewerHasReacted }"
          :title="reaction.content"
          @click="toggleReaction(reaction.content, reaction.viewerHasReacted)"
        >
          <span>{{ REACTION_EMOJI[reaction.content] }}</span>
          <span class="count">{{ reaction.count }}</span>
        </button>

        <span class="spacer" />

        <div class="menu-wrap">
          <button type="button" class="action-btn" :title="t.prComment" @click="reactionOpen = !reactionOpen">
            <NIcon :component="SyncOutline" :size="12" />
          </button>
          <div v-if="reactionOpen" class="reaction-menu">
            <button
              v-for="content in REACTIONS"
              :key="content"
              type="button"
              class="reaction-choice"
              @click="toggleReaction(content, reactions.some((entry) => entry.content === content && entry.viewerHasReacted))"
            >
              {{ REACTION_EMOJI[content] }}
            </button>
          </div>
        </div>

        <button v-if="comment.viewerCanUpdate" type="button" class="action-btn" :title="t.prEdit" @click="beginEdit">
          <NIcon :component="CreateOutline" :size="12" />
        </button>
        <button
          v-if="!compact"
          type="button"
          class="action-btn"
          :title="t.prReply.replace('…', '')"
          @click="emit('quote', comment.body)"
        >
          <NIcon :component="TextOutline" :size="12" />
        </button>
        <button v-if="comment.viewerCanDelete" type="button" class="action-btn danger" :title="t.prDelete" @click="removeComment">
          <NIcon :component="TrashOutline" :size="12" />
        </button>
        <button
          v-if="comment.kind === 'review' && canComment"
          type="button"
          class="action-btn"
          :title="t.prReply"
          @click="replying = !replying"
        >
          <NIcon :component="ChatbubbleOutline" :size="12" />
        </button>
        <button
          v-if="thread && !compact && (thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve)"
          type="button"
          class="action-btn"
          :title="thread.isResolved ? t.prUnresolveConversation : t.prResolveConversation"
          :disabled="busy"
          @click="toggleThread"
        >
          <NIcon :component="RefreshOutline" :size="12" />
        </button>
      </footer>

      <div v-if="comment.kind === 'review' && replies.length" class="replies">
        <button type="button" class="replies-toggle" @click="replyListOpen = !replyListOpen">
          <NIcon :component="replyListOpen ? ChevronDownOutline : ChevronForwardOutline" :size="11" />
          <span>{{ replies.length }}</span>
        </button>
        <div v-show="replyListOpen" class="reply-list">
          <PullRequestComment
            v-for="reply in replies"
            :key="reply.id"
            :comment="reply"
            :avatars="avatars"
            :images="images"
            :pending="pending"
            :pending-key="`edit-comment:${reply.id}`"
            :can-comment="canComment"
            compact
            @run="(action: PullRequestAction) => emit('run', action)"
          />
        </div>
      </div>

      <div v-if="replying" class="editor reply-editor">
        <NInput v-model:value="replyDraft" type="textarea" :placeholder="t.prReplyPlaceholder" :autosize="{ minRows: 2, maxRows: 8 }" />
        <div class="editor-actions">
          <NButton size="tiny" quaternary @click="replying = false">{{ t.cancel }}</NButton>
          <NButton size="tiny" type="primary" :disabled="!replyDraft.trim()" :loading="replyBusy" @click="submitReply">
            {{ t.prReply.replace("…", "") }}
          </NButton>
        </div>
      </div>
    </div>
  </article>
</template>

<script lang="ts">
export default { name: "PullRequestComment" };
</script>

<style scoped>
.pr-comment {
  display: flex;
  gap: 10px;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(127, 127, 127, 0.025);
}

.pr-comment.compact {
  border: 0;
  background: transparent;
  padding: 4px 0 4px 2px;
}

.pr-comment.compact .avatar {
  width: 20px;
  height: 20px;
}

.avatar {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-hover);
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
  font-size: 11px;
  color: var(--fg-muted);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.author {
  font-weight: 600;
  color: var(--fg);
}

.time {
  color: var(--fg-muted);
}

.tag {
  border-radius: 999px;
  padding: 0 6px;
  font-size: 10.5px;
  line-height: 15px;
  background: var(--bg-hover);
  color: var(--fg-muted);
}

.resolved-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--success);
  background: rgba(88, 124, 12, 0.14);
}

.hunk-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  font-size: 11px;
  padding: 1px 6px;
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hunk {
  margin: 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: rgba(127, 127, 127, 0.1);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-x: auto;
  white-space: pre;
}

.content {
  min-width: 0;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.reaction {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
}

.reaction.mine {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--accent);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.action-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.action-btn.danger:hover {
  color: var(--error);
}

.menu-wrap {
  position: relative;
}

.reaction-menu {
  position: absolute;
  right: 0;
  bottom: 22px;
  z-index: 20;
  display: flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.reaction-choice {
  border: 0;
  background: transparent;
  font-size: 14px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  padding: 2px 3px;
}

.reaction-choice:hover {
  background: var(--bg-hover);
}

.replies {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.replies-toggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

.reply-list {
  display: flex;
  flex-direction: column;
}
</style>
