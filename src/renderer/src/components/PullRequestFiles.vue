<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NIcon, NInput, NSpin } from "naive-ui";
import { ChatbubbleOutline, ChevronDownOutline, SearchOutline } from "@vicons/ionicons5";
import { DiffModeEnum, DiffView, SplitSide } from "@git-diff-view/vue";
import "@git-diff-view/vue/styles/diff-view-pure.css";
import type {
  PullRequestAction,
  PullRequestComment,
  PullRequestDetail,
  PullRequestThread,
} from "../../../shared/github-types";
import PullRequestCommentCard from "@renderer/components/PullRequestComment.vue";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { fileIcon } from "@renderer/utils/file-icon";
import { parseUnifiedDiff, type DiffFile } from "@renderer/utils/pull-request-diff";
import { t } from "@renderer/i18n";

const props = defineProps<{
  patch: string;
  loading: boolean;
  error: string | null;
  detail: PullRequestDetail;
  pending: Set<string>;
}>();

const emit = defineEmits<{
  (event: "run", action: PullRequestAction): void;
  (event: "reload"): void;
}>();

/** 与目标一致：默认只展开前 3 个文件，以及带未过时行评论的文件。 */
const DEFAULT_EXPAND_COUNT = 3;

const appearance = useAppearanceStore();
const layout = ref<"unified" | "split">("unified");
const fileFilter = ref("");
const expanded = ref<Set<string>>(defaultExpanded(props.detail));
const widgetTarget = ref<{ path: string; line: number; side: "LEFT" | "RIGHT" } | null>(null);
const widgetDraft = ref("");

const files = computed(() => parseUnifiedDiff(props.patch));

const shownFiles = computed(() => {
  const query = fileFilter.value.trim().toLowerCase();
  if (!query) return files.value;
  return files.value.filter((file) => file.path.toLowerCase().includes(query));
});

const diffMode = computed(() => (layout.value === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified));
const diffTheme = computed<"light" | "dark">(() => (appearance.resolvedTheme === "dark" ? "dark" : "light"));
const canComment = computed(() => Boolean(props.detail.viewer) && props.detail.pullRequest.state === "open");

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

function defaultExpanded(detail: PullRequestDetail): Set<string> {
  const commented = new Set(
    detail.comments
      .filter((comment) => comment.kind === "review" && comment.path && !comment.outdated)
      .map((comment) => comment.path as string),
  );
  return new Set(
    detail.files
      .filter((file, index) => index < DEFAULT_EXPAND_COUNT || commented.has(file.path))
      .map((file) => file.path),
  );
}

watch(
  () => props.detail.pullRequest.url,
  () => {
    expanded.value = defaultExpanded(props.detail);
    fileFilter.value = "";
    widgetTarget.value = null;
  },
);

const allOpen = computed(
  () => shownFiles.value.length > 0 && shownFiles.value.every((file) => expanded.value.has(file.path)),
);

function isOpen(path: string): boolean {
  return expanded.value.has(path);
}

function toggleFile(path: string): void {
  const next = new Set(expanded.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expanded.value = next;
}

function toggleAll(): void {
  const next = new Set(expanded.value);
  const open = allOpen.value;
  for (const file of shownFiles.value) {
    if (open) next.delete(file.path);
    else next.add(file.path);
  }
  expanded.value = next;
}

function conversationCount(path: string): number {
  return groups.value.filter((group) => group.root.path === path).length;
}

function fileGlyph(path: string): string {
  return fileIcon(path).glyph;
}

function fileGlyphColor(path: string): string {
  return fileIcon(path).color ?? "currentColor";
}

function diffDataOf(file: DiffFile) {
  return {
    oldFile: { fileName: file.previousPath ?? file.path },
    newFile: { fileName: file.path },
    hunks: [file.rawSection],
  };
}

function extendDataOf(file: DiffFile) {
  const oldFile: Record<string, { data: ThreadGroup }> = {};
  const newFile: Record<string, { data: ThreadGroup }> = {};
  for (const group of groups.value) {
    if (group.root.path !== file.path) continue;
    const line = group.root.line;
    if (line === undefined || group.root.outdated) continue;
    if (group.root.side === "LEFT") oldFile[String(line)] = { data: group };
    else newFile[String(line)] = { data: group };
  }
  return { oldFile, newFile };
}

function orphanGroups(file: DiffFile): ThreadGroup[] {
  return groups.value.filter(
    (group) => group.root.path === file.path && (group.root.line === undefined || group.root.outdated),
  );
}

function onAddWidgetClick(file: DiffFile, lineNumber: number, side: SplitSide): void {
  widgetTarget.value = {
    path: file.path,
    line: lineNumber,
    side: side === SplitSide.old ? "LEFT" : "RIGHT",
  };
  widgetDraft.value = "";
}

function isWidgetOpen(path: string, lineNumber: number, side: SplitSide): boolean {
  const target = widgetTarget.value;
  if (!target) return false;
  const expected = side === SplitSide.old ? "LEFT" : "RIGHT";
  return target.path === path && target.line === lineNumber && target.side === expected;
}

function closeWidget(onClose: () => void): void {
  widgetTarget.value = null;
  widgetDraft.value = "";
  onClose();
}

function submitWidget(file: DiffFile, lineNumber: number, side: SplitSide, onClose: () => void): void {
  const body = widgetDraft.value;
  if (!body.trim()) return;
  emit("run", {
    kind: "line-comment",
    path: file.path,
    line: lineNumber,
    side: side === SplitSide.old ? "LEFT" : "RIGHT",
    body,
    ...(props.detail.headSha ? { commitId: props.detail.headSha } : {}),
  });
  closeWidget(onClose);
}

function forward(action: PullRequestAction): void {
  emit("run", action);
}
</script>

<template>
  <div class="pr-files">
    <div v-if="loading" class="state"><NSpin size="small" />{{ t.prLoadingChanges }}</div>
    <div v-else-if="error" class="alert error">
      <p>{{ error }}</p>
      <button type="button" class="link-btn" @click="emit('reload')">{{ t.prRefresh }}</button>
    </div>
    <template v-else>
      <div class="files-toolbar">
        <div class="layout-tabs" role="tablist" :aria-label="t.prDiffLayout">
          <button
            type="button"
            role="tab"
            class="layout-tab"
            :class="{ active: layout === 'unified' }"
            :aria-selected="layout === 'unified'"
            @click="layout = 'unified'"
          >
            {{ t.prDiffUnified }}
          </button>
          <button
            type="button"
            role="tab"
            class="layout-tab"
            :class="{ active: layout === 'split' }"
            :aria-selected="layout === 'split'"
            @click="layout = 'split'"
          >
            {{ t.prDiffSplit }}
          </button>
        </div>
        <label class="file-filter">
          <NIcon :component="SearchOutline" :size="14" class="filter-icon" />
          <input
            v-model="fileFilter"
            type="search"
            :placeholder="t.prFilterFiles"
            :aria-label="t.prFilterFiles"
            @keydown.esc="fileFilter = ''"
          />
        </label>
        <span class="spacer" />
        <output class="files-summary">
          {{ t.prShowingFiles(shownFiles.length, props.detail.pullRequest.changedFiles ?? files.length) }}
        </output>
        <button type="button" class="expand-btn" :disabled="shownFiles.length === 0" @click="toggleAll">
          {{ allOpen ? t.prCollapseAll : t.prExpandAll }}
        </button>
      </div>

      <div v-if="detail.files.length === 0" class="state">{{ t.prNoFilesChanged }}</div>
      <div v-else-if="shownFiles.length === 0" class="state">{{ t.prNoFilesMatch(fileFilter.trim()) }}</div>

      <section v-for="file in shownFiles" :key="file.path" class="file">
        <button type="button" class="file-head" :aria-expanded="isOpen(file.path)" @click="toggleFile(file.path)">
          <NIcon
            :component="ChevronDownOutline"
            :size="14"
            class="chevron"
            :class="{ collapsed: !isOpen(file.path) }"
          />
          <span class="seti-glyph" :style="{ color: fileGlyphColor(file.path) }" aria-hidden="true">
            {{ fileGlyph(file.path) }}
          </span>
          <span class="file-path">{{ file.path }}</span>
          <span v-if="file.previousPath" class="renamed">{{ t.prRenamedFrom(file.previousPath) }}</span>
          <span v-if="conversationCount(file.path)" class="thread-count" :title="t.prCommentsCount(conversationCount(file.path))">
            <NIcon :component="ChatbubbleOutline" :size="13" />{{ conversationCount(file.path) }}
          </span>
          <span class="stats">
            <span v-if="file.additions" class="added">{{ t.prAdditionsCount(file.additions) }}</span>
            <span v-if="file.deletions" class="removed">{{ t.prDeletionsCount(file.deletions) }}</span>
          </span>
        </button>

        <div v-show="isOpen(file.path)" class="file-body">
          <p v-if="file.hunks.length === 0" class="file-note">{{ t.prNoTextChanges }}</p>
          <DiffView
            v-else
            :data="diffDataOf(file)"
            :diff-view-mode="diffMode"
            :diff-view-theme="diffTheme"
            :diff-view-highlight="false"
            :diff-view-wrap="false"
            :diff-view-font-size="12"
            :diff-view-add-widget="canComment"
            :extend-data="extendDataOf(file)"
            @add-widget-click="(lineNumber: number, side: SplitSide) => onAddWidgetClick(file, lineNumber, side)"
          >
            <template #widget="{ lineNumber, side, onClose }">
              <div v-if="isWidgetOpen(file.path, lineNumber, side)" class="widget-editor">
                <NInput
                  v-model:value="widgetDraft"
                  type="textarea"
                  :placeholder="t.prLineCommentPlaceholder"
                  :autosize="{ minRows: 2, maxRows: 8 }"
                />
                <div class="widget-actions">
                  <NButton size="tiny" quaternary @click="closeWidget(onClose)">{{ t.cancel }}</NButton>
                  <NButton
                    size="tiny"
                    type="primary"
                    :disabled="!widgetDraft.trim()"
                    @click="submitWidget(file, lineNumber, side, onClose)"
                  >
                    {{ t.prComment }}
                  </NButton>
                </div>
              </div>
            </template>
            <template #extend="{ data }">
              <div v-if="data?.group" class="extend-thread">
                <PullRequestCommentCard
                  :comment="data.group.root"
                  :thread="data.group.thread"
                  :replies="data.group.replies"
                  :avatars="detail.avatars"
                  :images="detail.images"
                  :pending="pending"
                  :pending-key="`resolve-thread:${data.group.thread?.id ?? ''}`"
                  :reply-key="`reply:${data.group.root.id}`"
                  can-comment
                  @run="forward"
                />
              </div>
            </template>
          </DiffView>

          <div v-if="orphanGroups(file).length" class="orphans">
            <div v-for="group in orphanGroups(file)" :key="group.root.id" class="extend-thread">
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
  gap: 12px;
  min-width: 0;
}

.files-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.layout-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
}

.layout-tab {
  height: 28px;
  border: 0;
  border-radius: 6px;
  padding: 0 12px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 13px;
  cursor: pointer;
}

.layout-tab:hover {
  color: var(--fg);
}

.layout-tab.active {
  background: rgba(127, 127, 127, 0.1);
  color: var(--fg);
  font-weight: 500;
}

.file-filter {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 260px;
  flex: 1;
}

.filter-icon {
  position: absolute;
  left: 10px;
  color: var(--fg-muted);
  pointer-events: none;
}

.file-filter input {
  width: 100%;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--fg);
  padding: 0 10px 0 32px;
  font-size: 13px;
  outline: none;
}

.file-filter input:focus {
  border-color: var(--accent-border);
}

.spacer {
  flex: 1;
}

.files-summary {
  font-size: 12px;
  color: var(--fg-muted);
}

.expand-btn {
  height: 28px;
  border: 0;
  border-radius: 6px;
  padding: 0 8px;
  margin-right: -8px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
}

.expand-btn:hover {
  background: rgba(127, 127, 127, 0.07);
  color: var(--fg);
}

.expand-btn:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.state {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 24px 12px;
  color: var(--fg-muted);
  font-size: 12.5px;
}

.alert {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.alert p {
  margin: 0;
  font-size: 13px;
}

.link-btn {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--fg);
  text-decoration: underline;
  cursor: pointer;
  font-size: 13px;
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
  min-height: 44px;
  padding: 8px 14px;
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

.chevron {
  flex: none;
  color: var(--fg-muted);
  transition: transform 0.15s ease;
}

.chevron.collapsed {
  transform: rotate(-90deg);
}

.seti-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  font-family: "seti";
  font-size: 14px;
  line-height: 1;
}

.file-path {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.renamed {
  color: var(--fg-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.thread-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  color: var(--fg-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.stats {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
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

/* 库默认用 GitHub 固定配色（纯白/深黑背景），改为跟随应用主题变量。 */
.file-body
  :deep(.diff-tailwindcss-wrapper[data-theme="light"] .diff-style-root),
.file-body
  :deep(.diff-tailwindcss-wrapper[data-theme="dark"] .diff-style-root) {
  --diff-border--: var(--border);
  --diff-plain-content--: transparent;
  --diff-plain-lineNumber--: rgba(127, 127, 127, 0.05);
  --diff-plain-lineNumber-color--: var(--fg-muted);
  --diff-expand-content--: rgba(127, 127, 127, 0.07);
  --diff-expand-lineNumber--: rgba(127, 127, 127, 0.07);
  --diff-expand-lineNumber-color--: var(--fg-muted);
  --diff-empty-content--: rgba(127, 127, 127, 0.04);
  --diff-add-content--: rgba(88, 124, 12, 0.12);
  --diff-del-content--: rgba(173, 7, 7, 0.12);
  --diff-add-lineNumber--: rgba(88, 124, 12, 0.2);
  --diff-del-lineNumber--: rgba(173, 7, 7, 0.2);
  --diff-add-content-highlight--: rgba(88, 124, 12, 0.24);
  --diff-del-content-highlight--: rgba(173, 7, 7, 0.24);
  --diff-hunk-content--: rgba(127, 127, 127, 0.08);
  --diff-hunk-lineNumber--: rgba(127, 127, 127, 0.12);
  --diff-hunk-content-color--: var(--fg-muted);
  --diff-hunk-lineNumber-hover--: var(--accent);
  --diff-add-widget--: var(--accent);
  background: transparent;
}

.file-body :deep(.diff-style-root) {
  background: transparent;
  font-size: 12px;
}

.file-note {
  margin: 0;
  padding: 24px 16px;
  color: var(--fg-muted);
  font-size: 12px;
}

.widget-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  min-width: 320px;
}

.widget-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.extend-thread {
  padding: 6px 10px;
  min-width: 320px;
}

.orphans {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0;
}
</style>
