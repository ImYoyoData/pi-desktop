<script setup lang="ts">
import { computed, ref } from "vue";
import { NButton, NInput, NIcon, NSpin } from "naive-ui";
import { ChatbubbleOutline, ChevronDownOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import type {
  PullRequestAction,
  PullRequestComment,
  PullRequestDetail,
  PullRequestThread,
} from "../../../shared/github-types";
import PullRequestCommentCard from "@renderer/components/PullRequestComment.vue";
import { parseUnifiedDiff, type DiffFile, type DiffLine } from "@renderer/utils/pull-request-diff";
import { t } from "@renderer/i18n";

const props = defineProps<{
  patch: string;
  loading: boolean;
  error: string | null;
  detail: PullRequestDetail;
  pending: Set<string>;
}>();

const emit = defineEmits<{ (event: "run", action: PullRequestAction): void }>();

const collapsed = ref<Set<string>>(new Set());
const lineTarget = ref<{ path: string; line: number; side: "LEFT" | "RIGHT"; startLine?: number } | null>(null);
const lineDraft = ref("");

const files = computed(() => parseUnifiedDiff(props.patch));

type ThreadGroup = { root: PullRequestComment; replies: PullRequestComment[]; thread: PullRequestThread | null };

const reviewComments = computed(() => props.detail.comments.filter((comment) => comment.kind === "review"));

function threadFor(commentId: number): PullRequestThread | null {
  return props.detail.threads.find((thread) => thread.rootCommentId === commentId) ?? null;
}

const groups = computed<ThreadGroup[]>(() => {
  const roots = reviewComments.value.filter((comment) => comment.inReplyToId === undefined);
  return roots.map((root) => ({
    root,
    replies: reviewComments.value.filter((comment) => comment.inReplyToId === root.id),
    thread: threadFor(root.id),
  }));
});

function lineOf(comment: PullRequestComment): number | null {
  if (comment.line === undefined) return null;
  return comment.line;
}

function sideOf(comment: PullRequestComment): "LEFT" | "RIGHT" {
  return comment.side === "LEFT" ? "LEFT" : "RIGHT";
}

function groupKey(group: ThreadGroup): string {
  return `${group.root.path ?? ""}:${sideOf(group.root)}:${lineOf(group.root) ?? ""}`;
}

function groupsFor(file: DiffFile, line: DiffLine): ThreadGroup[] {
  const locationKeys = new Set<string>();
  if (line.newNumber !== null) locationKeys.add(`${file.path}:RIGHT:${line.newNumber}`);
  if (line.oldNumber !== null) locationKeys.add(`${file.path}:LEFT:${line.oldNumber}`);
  return groups.value.filter((group) => locationKeys.has(groupKey(group)));
}

function orphanGroups(file: DiffFile): ThreadGroup[] {
  return groups.value.filter(
    (group) =>
      group.root.path === file.path &&
      lineOf(group.root) !== null &&
      !placedKeysForFile(file).has(groupKey(group)),
  );
}

function placedKeysForFile(file: DiffFile): Set<string> {
  const keys = new Set<string>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.newNumber !== null) keys.add(`${file.path}:RIGHT:${line.newNumber}`);
      if (line.oldNumber !== null) keys.add(`${file.path}:LEFT:${line.oldNumber}`);
    }
  }
  return keys;
}

function isCollapsed(path: string): boolean {
  return collapsed.value.has(path);
}

function toggleFile(path: string): void {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsed.value = next;
}

function beginLineComment(file: DiffFile, line: DiffLine): void {
  const right = line.newNumber !== null;
  lineTarget.value = {
    path: file.path,
    line: right ? line.newNumber! : line.oldNumber!,
    side: right ? "RIGHT" : "LEFT",
  };
  lineDraft.value = "";
}

function cancelLineComment(): void {
  lineTarget.value = null;
  lineDraft.value = "";
}

function isTarget(file: DiffFile, line: DiffLine): boolean {
  const target = lineTarget.value;
  if (!target || target.path !== file.path) return false;
  if (target.side === "RIGHT") return line.newNumber === target.line;
  return line.oldNumber === target.line;
}

function submitLineComment(): void {
  const target = lineTarget.value;
  const body = lineDraft.value;
  if (!target || !body.trim()) return;
  emit("run", {
    kind: "line-comment",
    path: target.path,
    line: target.line,
    side: target.side,
    body,
    ...(props.detail.headSha ? { commitId: props.detail.headSha } : {}),
  });
  cancelLineComment();
}

function markerOf(line: DiffLine): string {
  if (line.kind === "added") return "+";
  if (line.kind === "removed") return "-";
  return " ";
}

function forward(action: PullRequestAction): void {
  emit("run", action);
}

const AUTO_EXPAND_LIMIT = 10;

function isExpanded(path: string, index: number): boolean {
  if (isCollapsed(path)) return false;
  return index < AUTO_EXPAND_LIMIT || !collapsed.value.has(path);
}
</script>

<template>
  <div class="pr-files">
    <div v-if="loading" class="state"><NSpin size="small" />{{ t.prLoading }}</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else-if="files.length === 0" class="state">{{ t.prNoMatches }}</div>
    <template v-else>
      <section v-for="(file, index) in files" :key="file.path" class="file">
        <button type="button" class="file-head" @click="toggleFile(file.path)">
          <NIcon :component="isExpanded(file.path, index) ? ChevronDownOutline : ChevronForwardOutline" :size="12" />
          <span class="file-path">{{ file.path }}</span>
          <span v-if="file.previousPath" class="renamed">{{ t.prRenamedFrom(file.previousPath) }}</span>
          <span class="stats">
            <span v-if="file.additions" class="added">{{ t.prAdditionsCount(file.additions) }}</span>
            <span v-if="file.deletions" class="removed">{{ t.prDeletionsCount(file.deletions) }}</span>
          </span>
        </button>
        <div v-show="isExpanded(file.path, index)" class="file-body">
          <template v-for="(hunk, hunkIndex) in file.hunks" :key="`${file.path}-${hunkIndex}`">
            <div class="hunk-header">{{ hunk.header }}</div>
            <template v-for="(line, lineIndex) in hunk.lines" :key="`${file.path}-${hunkIndex}-${lineIndex}`">
              <div class="diff-line" :class="line.kind">
                <span class="ln">{{ line.oldNumber ?? "" }}</span>
                <span class="ln">{{ line.newNumber ?? "" }}</span>
                <span class="marker">{{ markerOf(line) }}</span>
                <span class="text">{{ line.text }}</span>
                <button
                  v-if="line.kind !== 'meta'"
                  type="button"
                  class="line-comment-btn"
                  :title="t.prLineComment"
                  @click="beginLineComment(file, line)"
                >
                  <NIcon :component="ChatbubbleOutline" :size="11" />
                </button>
              </div>
              <div v-if="isTarget(file, line)" class="line-editor">
                <NInput
                  v-model:value="lineDraft"
                  type="textarea"
                  :placeholder="t.prLineCommentPlaceholder"
                  :autosize="{ minRows: 2, maxRows: 8 }"
                />
                <div class="line-editor-actions">
                  <NButton size="tiny" quaternary @click="cancelLineComment">{{ t.cancel }}</NButton>
                  <NButton size="tiny" type="primary" :disabled="!lineDraft.trim()" @click="submitLineComment">
                    {{ t.prComment }}
                  </NButton>
                </div>
              </div>
              <div v-for="group in groupsFor(file, line)" :key="group.root.id" class="line-thread">
                <PullRequestCommentCard
                  :comment="group.root"
                  :thread="group.thread"
                  :replies="group.replies"
                  :avatars="detail.avatars"
                  :images="detail.images"
                  :pending="pending"
                  :pending-key="`resolve-thread:${group.thread?.id ?? ''}`"
                  :reply-key="`reply:${group.root.id}`"
                  can-comment
                  @run="forward"
                />
              </div>
            </template>
          </template>
          <div v-if="orphanGroups(file).length" class="orphans">
            <div v-for="group in orphanGroups(file)" :key="group.root.id" class="line-thread">
              <PullRequestCommentCard
                :comment="group.root"
                :thread="group.thread"
                :replies="group.replies"
                :avatars="detail.avatars"
                :images="detail.images"
                :pending="pending"
                :reply-key="`reply:${group.root.id}`"
                can-comment
                @run="forward"
              />
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pr-files {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.state {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 16px;
  color: var(--fg-muted);
  font-size: 12px;
}

.state.error {
  color: var(--error);
}

.file {
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.025);
}

.file-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  background: transparent;
  color: var(--fg);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.file-head:hover {
  background: rgba(127, 127, 127, 0.05);
}

.file-path {
  font-family: var(--font-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.renamed {
  color: var(--fg-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.stats .added {
  color: var(--diff-added);
}

.stats .removed {
  color: var(--diff-removed);
}

.file-body {
  border-top: 1px solid var(--border);
  overflow-x: auto;
}

.hunk-header {
  padding: 2px 8px;
  background: rgba(127, 127, 127, 0.1);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre;
}

.diff-line {
  display: grid;
  grid-template-columns: 38px 38px 16px 1fr auto;
  align-items: start;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 18px;
  min-width: max-content;
}

.diff-line.added {
  background: rgba(88, 124, 12, 0.1);
}

.diff-line.removed {
  background: rgba(173, 7, 7, 0.1);
}

.diff-line .ln {
  padding: 0 6px;
  text-align: right;
  color: var(--fg-muted);
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.diff-line .marker {
  text-align: center;
  color: var(--fg-muted);
  user-select: none;
}

.diff-line .text {
  padding-right: 8px;
  white-space: pre;
}

.line-comment-btn {
  visibility: hidden;
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 0 6px;
}

.diff-line:hover .line-comment-btn {
  visibility: visible;
}

.line-comment-btn:hover {
  color: var(--accent);
}

.line-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  min-width: 260px;
}

.line-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.line-thread {
  padding: 6px 8px;
  background: var(--bg);
  border-top: 1px solid var(--border);
  min-width: 280px;
}

.orphans {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0;
}
</style>
