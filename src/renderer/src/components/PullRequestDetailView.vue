<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { NButton, NDropdown, NIcon, NInput, NSpin, useMessage } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import {
  ArrowBackOutline,
  ChevronDownOutline,
  CloseCircleOutline,
  FlagOutline,
  GitCommitOutline,
  GitMerge,
  LinkOutline,
  OpenOutline,
  PeopleOutline,
  PencilOutline,
  PersonAddOutline,
  PersonOutline,
  PricetagOutline,
  RefreshOutline,
} from "@vicons/ionicons5";
import type {
  PullRequestAction,
  PullRequestCheck,
  PullRequestChoices,
  PullRequestDetail,
  PullRequestLabel,
  PullRequestMergeMethod,
  PullRequestReviewState,
} from "../../../shared/github-types";
import GitHubAvatar from "@renderer/components/GitHubAvatar.vue";
import GitPullRequestIcon from "@renderer/components/icons/GitPullRequestIcon.vue";
import PullRequestChoicePopover, { type ChoiceOption } from "@renderer/components/PullRequestChoicePopover.vue";
import PullRequestConversation from "@renderer/components/PullRequestConversation.vue";
import PullRequestFiles from "@renderer/components/PullRequestFiles.vue";
import {
  canMerge,
  canTriage,
  checksSummary,
  formatPullRequestDate,
  formatPullRequestRelative,
  hasWritePermission,
  mergeStateLabel,
  pullRequestStateLabel,
  reviewStateLabel,
} from "@renderer/utils/pull-request-format";
import { t } from "@renderer/i18n";
import { plainIpcArgs } from "@renderer/utils/ipc-plain";

const props = defineProps<{ url: string }>();
const emit = defineEmits<{ (event: "back"): void }>();

const message = useMessage();

type DetailSection = "conversation" | "commits" | "checks" | "files";

const DETAIL_TTL_MS = 30_000;
const detailCache = new Map<string, { detail: PullRequestDetail; at: number }>();

const detail = ref<PullRequestDetail | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const section = ref<DetailSection>("conversation");
const pending = ref<Set<string>>(new Set());
const patch = ref("");
const patchHead = ref<string | null>(null);
const patchLoading = ref(false);
const patchError = ref<string | null>(null);
const staleNotice = ref(false);
const editingTitle = ref(false);
const titleDraft = ref("");
const reviewOpen = ref(false);
const reviewEvent = ref<"approve" | "request-changes" | "comment">("comment");
const reviewBody = ref("");
const choices = ref<PullRequestChoices>({});
const choicesLoading = ref(false);
const choicesError = ref<string | null>(null);

const pullRequest = computed(() => detail.value?.pullRequest ?? null);
const checks = computed(() => pullRequest.value?.checks ?? []);
const summary = computed(() => checksSummary(checks.value));
const canWrite = computed(() => hasWritePermission(detail.value?.viewerPermission ?? "none"));
const canEditMeta = computed(() => canTriage(detail.value?.viewerPermission ?? "none"));
const mergeReady = computed(() =>
  detail.value && pullRequest.value ? canMerge(pullRequest.value, detail.value.mergeState) : false,
);
const mergeMethods = computed<PullRequestMergeMethod[]>(() => {
  const methods = detail.value?.mergeMethods ?? [];
  return methods.length > 0 ? methods : ["squash", "merge", "rebase"];
});

const sections = computed(() => [
  { key: "conversation" as const, label: t.prConversation, count: detail.value?.comments.length },
  { key: "commits" as const, label: t.prCommitsTab, count: detail.value?.commits.length },
  { key: "checks" as const, label: t.prChecksTab, count: summary.value.total || undefined },
  {
    key: "files" as const,
    label: t.prFilesTab,
    count: pullRequest.value?.changedFiles ?? detail.value?.files.length,
  },
]);

const participants = computed(() => {
  const target = detail.value;
  if (!target) return [];
  const people = new Set<string>();
  if (target.pullRequest.author) people.add(target.pullRequest.author);
  for (const comment of target.comments) people.add(comment.author);
  for (const review of target.reviews) people.add(review.author);
  for (const login of target.assignees) people.add(login);
  return [...people].filter(Boolean);
});

const banner = computed<{ tone: string; text: string }>(() => {
  const pr = pullRequest.value;
  const state = detail.value?.mergeState ?? "unknown";
  if (!pr) return { tone: "muted", text: "" };
  if (pr.state === "merged") return { tone: "success", text: t.prMergedBanner };
  if (pr.state === "closed") return { tone: "danger", text: t.prClosedBanner };
  if (pr.isDraft) return { tone: "muted", text: t.prMergeStateDraft };
  if (pr.reviewDecision === "changes-requested") return { tone: "danger", text: t.prChangesRequestedBanner };
  if (state === "blocked" && pr.reviewDecision === "review-required") {
    return { tone: "warning", text: t.prReviewRequiredBanner };
  }
  if (
    (state === "unstable" || state === "blocked") &&
    checks.value.some((check) => check.state === "pending") &&
    !checks.value.some((check) => check.state === "failure")
  ) {
    return { tone: "warning", text: t.prChecksRunningBanner };
  }
  const tone =
    state === "clean" ? "success" : state === "conflicts" ? "danger" : state === "unknown" ? "muted" : "warning";
  return { tone, text: mergeStateLabel(state) };
});

function actionKey(action: PullRequestAction): string {
  if (action.kind === "reply") return `reply:${action.commentId}`;
  if (action.kind === "resolve-thread") return `resolve-thread:${action.threadId}`;
  if (action.kind === "line-comment") return `line-comment:${action.path}`;
  if (action.kind === "rerun-checks") return `rerun-checks:${action.urls.join(" ")}`;
  if (action.kind === "edit-comment") return `edit-comment:${action.commentId}`;
  return action.kind;
}

async function loadDetail(force = false): Promise<void> {
  const url = props.url;
  const cached = detailCache.get(url);
  if (!force && cached && Date.now() - cached.at < DETAIL_TTL_MS) {
    detail.value = cached.detail;
    return;
  }
  loading.value = detail.value === null;
  error.value = null;
  try {
    const response = await window.api.github.pullRequestDetail(plainIpcArgs({ url }));
    if (!response.success) {
      error.value = response.error || t.prCouldNotLoad;
      return;
    }
    const next = response.detail;
    if (patchHead.value !== null && patchHead.value !== next.headSha) {
      patchHead.value = null;
      patch.value = "";
      patchError.value = t.prStaleNotice;
    }
    detailCache.set(url, { detail: next, at: Date.now() });
    detail.value = next;
  } catch {
    error.value = t.prCouldNotLoad;
  } finally {
    loading.value = false;
  }
}

async function loadPatch(force = false): Promise<void> {
  if (!detail.value || (patch.value && !force)) return;
  patchLoading.value = true;
  patchError.value = null;
  try {
    const head = detail.value.headSha;
    const response = await window.api.github.pullRequestPatch(
      plainIpcArgs({
        url: props.url,
        ...(/^[0-9a-f]{40}$/.test(head) ? { headSha: head } : {}),
      }),
    );
    if (!response.success) {
      patchError.value = response.error || t.prCouldNotLoadFiles;
      return;
    }
    if (response.stale) {
      staleNotice.value = true;
      patchHead.value = null;
      patch.value = "";
      await loadDetail(true);
      return;
    }
    patch.value = response.patch;
    patchHead.value = response.headSha || head || null;
  } catch {
    patchError.value = t.prCouldNotLoadFiles;
  } finally {
    patchLoading.value = false;
  }
}

async function run(action: PullRequestAction): Promise<boolean> {
  const key = actionKey(action);
  const next = new Set(pending.value);
  next.add(key);
  pending.value = next;
  try {
		const response = await window.api.github.pullRequestAction(
			plainIpcArgs({ url: props.url, action }),
		);
    if (!response.success) {
      message.error(response.error || t.prCouldNotUpdate);
      return false;
    }
    await loadDetail(true);
    if (patch.value && section.value === "files") await loadPatch(true);
    return true;
  } catch {
    message.error(t.prCouldNotUpdate);
    return false;
  } finally {
    const settled = new Set(pending.value);
    settled.delete(key);
    pending.value = settled;
  }
}

function selectSection(next: DetailSection): void {
  section.value = next;
  if (next === "files") void loadPatch();
}

function openExternal(): void {
  if (pullRequest.value) void window.api.browser.openExternal(pullRequest.value.url);
}

function beginTitleEdit(): void {
  if (!detail.value?.viewerCanUpdate || !pullRequest.value) return;
  titleDraft.value = pullRequest.value.title;
  editingTitle.value = true;
}

async function submitTitle(): Promise<void> {
  const title = titleDraft.value.trim();
  const current = pullRequest.value?.title ?? "";
  if (!title || title === current) {
    editingTitle.value = false;
    return;
  }
  if (await run({ kind: "edit-title", title })) editingTitle.value = false;
}

function mergeOptions(): DropdownOption[] {
  return mergeMethods.value.map((method) => ({
    label:
      method === "squash" ? t.prSquashAndMerge : method === "merge" ? t.prCreateMergeCommit : t.prRebaseAndMerge,
    key: method,
  }));
}

async function onMergeSelect(method: PullRequestMergeMethod): Promise<void> {
  const head = detail.value?.headSha ?? "";
  if (!/^[0-9a-f]{40}$/.test(head)) {
    message.error(t.prCouldNotUpdate);
    return;
  }
  await run({ kind: "merge", method, headSha: head });
}

function beginReview(event: "approve" | "request-changes" | "comment"): void {
  reviewEvent.value = event;
  reviewBody.value = "";
  reviewOpen.value = true;
}

async function submitReview(): Promise<void> {
  const body = reviewBody.value;
  if (reviewEvent.value !== "approve" && !body.trim()) {
    message.warning(t.prReviewCommentRequired);
    return;
  }
  if (await run({ kind: "review", event: reviewEvent.value, body })) reviewOpen.value = false;
}

async function setState(state: "close" | "reopen" | "ready" | "draft"): Promise<void> {
  await run({ kind: "state", state });
}

async function loadChoices(kind: "labels" | "people" | "milestones"): Promise<void> {
  const loaded =
    kind === "labels" ? choices.value.labels : kind === "people" ? choices.value.people : choices.value.milestones;
  if (loaded) return;
  choicesLoading.value = true;
  choicesError.value = null;
  try {
    const response = await window.api.github.pullRequestChoices(plainIpcArgs({ url: props.url, kind }));
    if (!response.success) {
      choicesError.value = response.error || t.prCouldNotLoadChoices;
      return;
    }
    choices.value = {
      ...choices.value,
      labels: response.labels ?? choices.value.labels,
      people: response.people ?? choices.value.people,
      milestones: response.milestones ?? choices.value.milestones,
    };
  } finally {
    choicesLoading.value = false;
  }
}

function labelChoiceOptions(): ChoiceOption[] {
  return (choices.value.labels ?? []).map((label) => ({ value: label.name, color: label.color }));
}

function peopleChoiceOptions(): ChoiceOption[] {
  return (choices.value.people ?? []).map((login) => ({ value: login }));
}

function milestoneChoiceOptions(): ChoiceOption[] {
  return (choices.value.milestones ?? []).map((milestone) => ({ value: milestone.title }));
}

function toggleName(kind: "labels" | "assignees" | "reviewers", value: string, on: boolean): void {
  const current = currentNames(kind);
  const next = on ? [...current, value] : current.filter((name) => name !== value);
  void applyNames(kind, next);
}

function currentNames(kind: "labels" | "assignees" | "reviewers"): string[] {
  const target = detail.value;
  if (!target) return [];
  if (kind === "labels") return target.labels.map((label) => label.name);
  if (kind === "assignees") return target.assignees;
  return target.reviewRequests;
}

async function applyNames(kind: "labels" | "assignees" | "reviewers", next: string[]): Promise<void> {
  const current = currentNames(kind);
  const add = next.filter((name) => !current.includes(name));
  const remove = current.filter((name) => !next.includes(name));
  if (add.length === 0 && remove.length === 0) return;
  await run({ kind, add, remove });
}

async function applyMilestone(title: string | null): Promise<void> {
  await run({ kind: "milestone", title });
}

function rerunChecks(failedOnly: boolean): void {
  const urls = checks.value.map((check) => check.url ?? "").filter((url) => url.includes("/actions/runs/"));
  if (urls.length === 0) {
    message.warning(t.prNoChecks);
    return;
  }
  void run({ kind: "rerun-checks", urls, failedOnly });
}

function checkStateClass(check: PullRequestCheck): string {
  if (check.state === "success") return "success";
  if (check.state === "failure") return "danger";
  if (check.state === "pending") return "warning";
  return "muted";
}

function reviewStateClass(state: PullRequestReviewState): string {
  if (state === "approved") return "success";
  if (state === "changes-requested") return "danger";
  return "muted";
}

function labelStyle(label: PullRequestLabel): Record<string, string> {
  return { borderColor: `#${label.color}`, color: `#${label.color}` };
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  ) {
    return;
  }
  if (document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], .n-popover')) return;
  emit("back");
}

watch(
  () => props.url,
  () => {
    detail.value = null;
    patch.value = "";
    patchHead.value = null;
    patchError.value = null;
    staleNotice.value = false;
    section.value = "conversation";
    void loadDetail();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("keydown", onEscape);
  void loadDetail();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onEscape);
});

defineExpose({ refresh: () => loadDetail(true) });
</script>

<template>
  <div class="pr-detail">
    <header class="detail-head">
      <div class="head-row">
        <button type="button" class="back-btn" @click="emit('back')">
          <NIcon :component="ArrowBackOutline" :size="14" />
          <span>{{ t.pullRequests }}</span>
        </button>
        <span class="spacer" />
        <button type="button" class="ghost-btn" :disabled="loading" @click="loadDetail(true)">
          <NIcon :component="RefreshOutline" :size="14" :class="{ spinning: loading }" />
        </button>
        <button v-if="pullRequest" type="button" class="ghost-btn" @click="openExternal">
          <NIcon :component="OpenOutline" :size="14" />
          <span>GitHub</span>
        </button>
        <NDropdown
          v-if="canWrite && pullRequest?.state === 'open'"
          trigger="click"
          :options="[
            { label: t.prApprove, key: 'approve' },
            { label: t.prRequestChanges, key: 'request-changes' },
            { label: t.prComment, key: 'comment' },
          ]"
          @select="(key: string) => beginReview(key as 'approve' | 'request-changes' | 'comment')"
        >
          <NButton size="small" type="primary">
            <span class="review-btn">
              {{ t.prSubmitReview }}
              <NIcon :component="ChevronDownOutline" :size="12" />
            </span>
          </NButton>
        </NDropdown>
      </div>

      <div v-if="loading && !detail" class="skeleton-title">
        <NSpin size="small" />
      </div>

      <template v-else-if="pullRequest">
        <div class="title-row">
          <NIcon
            :component="pullRequest.state === 'merged' ? GitMerge : pullRequest.state === 'closed' ? CloseCircleOutline : GitPullRequestIcon"
            :size="20"
            class="state-icon"
            :class="pullRequest.state === 'merged' ? 'merged' : pullRequest.state === 'closed' ? 'closed' : pullRequest.isDraft ? 'draft' : 'open'"
          />
          <h1 v-if="!editingTitle" class="title">
            {{ pullRequest.title }}
            <span class="number">
              #{{ pullRequest.number }}
              <button v-if="detail?.viewerCanUpdate" type="button" class="edit-title" :title="t.prEditTitle" @click="beginTitleEdit">
                <NIcon :component="PencilOutline" :size="13" />
              </button>
            </span>
          </h1>
          <div v-else class="title-editor">
            <input
              v-model="titleDraft"
              class="title-input"
              maxlength="256"
              :aria-label="t.prEditTitle"
              @keydown.enter.prevent="submitTitle"
              @keydown.esc="editingTitle = false"
            />
            <NButton size="small" type="primary" :loading="pending.has('edit-title')" @click="submitTitle">
              {{ t.prSave }}
            </NButton>
            <NButton size="small" quaternary @click="editingTitle = false">{{ t.cancel }}</NButton>
          </div>
          <span v-if="pullRequest" class="state-badge" :class="banner.tone">{{ pullRequestStateLabel(pullRequest) }}</span>
        </div>

        <div class="meta-row">
          <span v-if="pullRequest.author" class="meta-item">
            <GitHubAvatar :login="pullRequest.author" :avatars="detail?.avatars" size="md" />
            {{ pullRequest.author }}
          </span>
          <span v-if="pullRequest.headBranch" class="meta-item branch">
            <span class="branch-pill">{{ pullRequest.headBranch }}</span>
            <span v-if="pullRequest.baseBranch" class="arrow">→</span>
            <span v-if="pullRequest.baseBranch" class="branch-pill">{{ pullRequest.baseBranch }}</span>
          </span>
          <span class="spacer" />
          <span v-if="pullRequest.additions !== undefined && pullRequest.deletions !== undefined" class="meta-item diff-stat">
            <span class="added">{{ t.prAdditionsCount(pullRequest.additions) }}</span>
            <span class="removed">{{ t.prDeletionsCount(pullRequest.deletions) }}</span>
            <span v-if="pullRequest.changedFiles !== undefined" class="files">{{ t.prFileCount(pullRequest.changedFiles) }}</span>
          </span>
        </div>
      </template>
    </header>

    <div v-if="error && !detail" class="alert error">
      <span>{{ error }}</span>
      <button type="button" class="link-btn" @click="loadDetail(true)">{{ t.prRefresh }}</button>
    </div>
    <div v-else-if="error && detail" class="alert error compact">
      <span class="ellipsis">{{ error }}</span>
      <button type="button" class="link-btn" @click="loadDetail(true)">{{ t.prRefresh }}</button>
    </div>
    <div v-if="detail?.enrichmentFailed && !loading" class="alert warning">
      <span>{{ t.prEnrichmentFailed }}</span>
      <button type="button" class="link-btn" @click="loadDetail(true)">{{ t.prRefresh }}</button>
    </div>

    <nav v-if="detail" class="sections">
      <button
        v-for="item in sections"
        :key="item.key"
        type="button"
        class="section-tab"
        :class="{ active: section === item.key }"
        @click="selectSection(item.key)"
      >
        {{ item.label }}
        <span v-if="item.count" class="count">{{ item.count }}</span>
      </button>
    </nav>

    <div v-if="reviewOpen" class="review-panel">
      <div class="review-head">{{ reviewEvent === "approve" ? t.prApprove : reviewEvent === "request-changes" ? t.prRequestChanges : t.prComment }}</div>
      <NInput
        v-model:value="reviewBody"
        type="textarea"
        :placeholder="reviewEvent === 'approve' ? t.prReviewBodyPlaceholder : t.prReviewCommentRequired"
        :autosize="{ minRows: 3, maxRows: 12 }"
      />
      <div class="review-actions">
        <NButton size="tiny" quaternary @click="reviewOpen = false">{{ t.cancel }}</NButton>
        <NButton size="tiny" type="primary" :loading="pending.has('review')" @click="submitReview">
          {{ t.prSubmitReview }}
        </NButton>
      </div>
    </div>

    <div v-if="detail" class="detail-grid">
      <div class="detail-main">
        <PullRequestConversation
          v-if="section === 'conversation'"
          :detail="detail"
          :pending="pending"
          @run="run"
        />
        <div v-else-if="section === 'commits'" class="commits">
          <div v-for="commit in detail.commits" :key="commit.oid" class="commit">
            <NIcon :component="GitCommitOutline" :size="14" class="commit-icon" />
            <div class="commit-main">
              <div class="commit-headline">{{ commit.headline }}</div>
              <div class="commit-meta">
                <span class="oid">{{ commit.oid.slice(0, 7) }}</span>
                <span>{{ commit.author }}</span>
                <span>{{ formatPullRequestDate(commit.authoredAt) }}</span>
              </div>
            </div>
          </div>
          <div v-if="detail.commits.length === 0" class="empty">{{ t.prNoMatches }}</div>
        </div>
        <div v-else-if="section === 'checks'" class="checks">
          <div class="checks-actions">
            <NButton size="small" quaternary :disabled="summary.failed === 0" @click="rerunChecks(true)">
              {{ t.prRerunFailed }}
            </NButton>
            <NButton size="small" quaternary :disabled="summary.total === 0" @click="rerunChecks(false)">
              {{ t.prRerunAll }}
            </NButton>
          </div>
          <ul class="check-list">
            <li v-for="check in checks" :key="`${check.name}-${check.url ?? ''}`" class="check">
              <span class="dot" :class="checkStateClass(check)" />
              <span class="check-name">{{ check.name }}</span>
              <span class="check-state" :class="checkStateClass(check)">
                {{
                  check.state === "success"
                    ? t.prChecksPassing
                    : check.state === "failure"
                      ? t.prChecksFailing
                      : check.state === "pending"
                        ? t.prChecksRunning
                        : t.prNoChecks
                }}
              </span>
            </li>
          </ul>
          <div v-if="checks.length === 0" class="empty">{{ t.prNoChecks }}</div>
          <div v-if="detail.reviews.length" class="reviews">
            <div class="reviews-title">{{ t.prReviewers }}</div>
            <div v-for="review in detail.reviews" :key="review.id" class="review-row">
              <span class="review-author">{{ review.author }}</span>
              <span class="badge" :class="reviewStateClass(review.state)">{{ reviewStateLabel(review.state) }}</span>
              <span class="muted">{{ formatPullRequestRelative(review.submittedAt) }}</span>
            </div>
          </div>
        </div>
        <PullRequestFiles
          v-else
          :patch="patch"
          :loading="patchLoading"
          :error="patchError"
          :detail="detail"
          :pending="pending"
          @run="run"
          @reload="loadPatch(true)"
        />
      </div>

      <aside class="detail-side">
        <section class="side-block">
          <header class="side-head">
            <NIcon :component="PeopleOutline" :size="14" class="side-icon" />
            <span>{{ t.prReviewers }}</span>
            <PullRequestChoicePopover
              v-if="canEditMeta"
              :title="t.prReviewers"
              :options="peopleChoiceOptions()"
              :selected="detail.reviewRequests"
              :loading="choicesLoading"
              :error="choicesError"
              multi
              @load="loadChoices('people')"
              @toggle="(value: string, on: boolean) => toggleName('reviewers', value, on)"
            />
          </header>
          <ul v-if="detail.reviewRequests.length" class="side-list">
            <li v-for="login in detail.reviewRequests" :key="login" class="side-row">
              <GitHubAvatar :login="login" :avatars="detail.avatars" size="sm" />
              <span class="ellipsis">{{ login }}</span>
            </li>
          </ul>
          <p v-else class="side-empty">{{ t.prNoReviewers }}</p>
        </section>

        <section class="side-block">
          <header class="side-head">
            <NIcon :component="PersonAddOutline" :size="14" class="side-icon" />
            <span>{{ t.prAssignees }}</span>
            <PullRequestChoicePopover
              v-if="canEditMeta"
              :title="t.prAssignees"
              :options="peopleChoiceOptions()"
              :selected="detail.assignees"
              :loading="choicesLoading"
              :error="choicesError"
              multi
              @load="loadChoices('people')"
              @toggle="(value: string, on: boolean) => toggleName('assignees', value, on)"
            />
          </header>
          <ul v-if="detail.assignees.length" class="side-list">
            <li v-for="login in detail.assignees" :key="login" class="side-row">
              <GitHubAvatar :login="login" :avatars="detail.avatars" size="sm" />
              <span class="ellipsis">{{ login }}</span>
            </li>
          </ul>
          <p v-else class="side-empty">{{ t.prNoAssignees }}</p>
        </section>

        <section class="side-block">
          <header class="side-head">
            <NIcon :component="PricetagOutline" :size="14" class="side-icon" />
            <span>{{ t.prLabels }}</span>
            <PullRequestChoicePopover
              v-if="canEditMeta"
              :title="t.prLabels"
              :options="labelChoiceOptions()"
              :selected="detail.labels.map((label) => label.name)"
              :loading="choicesLoading"
              :error="choicesError"
              multi
              @load="loadChoices('labels')"
              @toggle="(value: string, on: boolean) => toggleName('labels', value, on)"
            />
          </header>
          <div v-if="detail.labels.length" class="label-chips">
            <span v-for="label in detail.labels" :key="label.name" class="label-chip" :style="labelStyle(label)">
              {{ label.name }}
            </span>
          </div>
          <p v-else class="side-empty">{{ t.prNoLabels }}</p>
        </section>

        <section class="side-block">
          <header class="side-head">
            <NIcon :component="FlagOutline" :size="14" class="side-icon" />
            <span>{{ t.prMilestone }}</span>
            <PullRequestChoicePopover
              v-if="canEditMeta"
              :title="t.prMilestone"
              :options="milestoneChoiceOptions()"
              :selected="detail.milestone ? [detail.milestone.title] : []"
              :loading="choicesLoading"
              :error="choicesError"
              @load="loadChoices('milestones')"
              @toggle="(value: string, on: boolean) => applyMilestone(on ? value : null)"
            />
          </header>
          <p v-if="detail.milestone" class="side-text">{{ detail.milestone.title }}</p>
          <p v-else class="side-empty">{{ t.prNoMilestone }}</p>
        </section>

        <section v-if="detail.linkedIssues.length" class="side-block">
          <header class="side-head">
            <NIcon :component="LinkOutline" :size="14" class="side-icon" />
            <span>{{ t.prLinkedIssues }}</span>
          </header>
          <ul class="side-list">
            <li v-for="issue in detail.linkedIssues" :key="issue.url" class="side-row">
              <span class="issue-state" :class="issue.state">{{ issue.state === "open" ? "open" : "closed" }}</span>
              <span class="ellipsis">#{{ issue.number }} {{ issue.title }}</span>
            </li>
          </ul>
        </section>

        <section v-if="participants.length" class="side-block">
          <header class="side-head">
            <NIcon :component="PersonOutline" :size="14" class="side-icon" />
            <span>{{ t.prReviewers }}</span>
          </header>
          <div class="participants">
            <GitHubAvatar
              v-for="login in participants"
              :key="login"
              :login="login"
              :avatars="detail.avatars"
              size="lg"
            />
          </div>
        </section>

        <section class="side-block">
          <header class="side-head">
            <NIcon :component="GitMerge" :size="14" class="side-icon" />
            <span>{{ t.prMerge }}</span>
            <span class="dot" :class="banner.tone" />
          </header>
          <p class="side-text" :class="banner.tone">{{ banner.text }}</p>
          <p class="side-muted">
            {{
              summary.total
                ? t.prChecksPassed(summary.passed, summary.total)
                : t.prNoChecks
            }}
          </p>
          <div class="merge-actions">
            <NDropdown
              v-if="canWrite && pullRequest?.state === 'open'"
              trigger="click"
              :options="mergeOptions()"
              :disabled="!mergeReady"
              @select="(key: string) => onMergeSelect(key as PullRequestMergeMethod)"
            >
              <NButton size="small" type="primary" :disabled="!mergeReady || pending.has('merge')">
                <NIcon :component="GitMerge" :size="13" />
                {{ t.prMerge }}
              </NButton>
            </NDropdown>
            <NButton
              v-if="canWrite && pullRequest?.state === 'open'"
              size="small"
              quaternary
              :disabled="pending.has('update-branch')"
              @click="run({ kind: 'update-branch', rebase: false })"
            >
              {{ t.prRefresh }}
            </NButton>
            <NButton
              v-if="canWrite && pullRequest?.state === 'open'"
              size="small"
              quaternary
              @click="setState('close')"
            >
              {{ t.prClosePullRequest }}
            </NButton>
            <NButton v-if="canWrite && pullRequest?.state !== 'open'" size="small" quaternary @click="setState('reopen')">
              {{ t.prReopenPullRequest }}
            </NButton>
            <NButton
              v-if="canWrite && pullRequest?.state === 'open'"
              size="small"
              quaternary
              @click="setState(pullRequest.isDraft ? 'ready' : 'draft')"
            >
              {{ pullRequest.isDraft ? t.prReadyForReview : t.prConvertToDraft }}
            </NButton>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.pr-detail {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 20px 24px 48px;
  color: var(--fg);
  font-size: 13px;
}

@media (min-width: 1024px) {
  .pr-detail {
    padding: 20px 40px 48px;
  }
}

.detail-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.back-btn,
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
}

.back-btn {
  margin-left: -8px;
}

.back-btn:hover,
.ghost-btn:hover {
  background: rgba(127, 127, 127, 0.07);
  color: var(--fg);
}

.ghost-btn:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.spacer {
  flex: 1;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.review-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.skeleton-title {
  padding: 8px 0;
}

.title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.state-icon {
  flex: none;
  margin-top: 3px;
}

.state-icon.open {
  color: var(--success);
}

.state-icon.merged {
  color: #8250df;
}

.state-icon.closed {
  color: var(--error);
}

.state-icon.draft {
  color: var(--fg-muted);
}

.title {
  margin: 0;
  min-width: 0;
  flex: 1;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.title .number {
  margin-left: 8px;
  font-size: 16px;
  font-weight: 400;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.edit-title {
  margin-left: 6px;
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  vertical-align: middle;
}

.edit-title:hover {
  color: var(--accent);
}

.title-editor {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.title-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--fg);
  font-size: 16px;
  font-weight: 500;
}

.state-badge {
  flex: none;
  margin-top: 4px;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  background: var(--bg-hover);
  color: var(--fg-muted);
}

.state-badge.success {
  background: rgba(88, 124, 12, 0.16);
  color: var(--success);
}

.state-badge.danger {
  background: rgba(173, 7, 7, 0.14);
  color: var(--error);
}

.state-badge.warning {
  background: rgba(191, 136, 3, 0.16);
  color: var(--warning);
}

.meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding-left: 30px;
  color: var(--fg-muted);
  font-size: 13px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.meta-item.branch {
  font-family: var(--font-mono);
  font-size: 12px;
}

.branch-pill {
  border-radius: var(--radius-sm);
  padding: 0 5px;
  background: var(--bg-hover);
}

.arrow {
  color: var(--fg-muted);
}

.diff-stat .added {
  color: var(--diff-added);
}

.diff-stat .removed {
  color: var(--diff-removed);
}

.diff-stat .files {
  color: var(--fg-muted);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-hover);
  flex: none;
}

.avatar.small {
  width: 22px;
  height: 22px;
}

.avatar.tiny {
  width: 18px;
  height: 18px;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  font-size: 10px;
  color: var(--fg-muted);
}

.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12.5px;
}

.alert.error {
  border-color: rgba(173, 7, 7, 0.3);
  background: rgba(173, 7, 7, 0.06);
}

.alert.warning {
  border-color: rgba(191, 136, 3, 0.3);
  background: rgba(191, 136, 3, 0.06);
}

.alert.compact {
  padding: 6px 10px;
}

.ellipsis {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-btn {
  border: 0;
  background: transparent;
  color: var(--fg);
  text-decoration: underline;
  cursor: pointer;
  font-size: 12.5px;
  white-space: nowrap;
}

.sections {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 20px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
  align-self: flex-start;
}

.section-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 13px;
  padding: 0 12px;
  cursor: pointer;
}

.section-tab:hover {
  color: var(--fg);
}

.section-tab.active {
  background: rgba(127, 127, 127, 0.1);
  color: var(--fg);
  font-weight: 500;
}

.section-tab .count {
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.1);
  padding: 0 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.review-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
}

.review-head {
  font-size: 12.5px;
  font-weight: 600;
}

.review-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  margin-top: 24px;
  min-width: 0;
}

@media (min-width: 1280px) {
  .detail-grid {
    grid-template-columns: minmax(0, 1fr) 280px;
  }
}

.detail-main {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.detail-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.side-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(127, 127, 127, 0.05);
}

.side-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}

.side-icon {
  color: var(--fg-muted);
}

.side-edit {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 13px;
}

.side-edit:hover {
  color: var(--accent);
}

.side-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.side-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg);
  min-width: 0;
}

.side-empty,
.side-muted {
  margin: 0;
  font-size: 12px;
  color: var(--fg-muted);
}

.side-text {
  margin: 0;
  font-size: 12.5px;
}

.side-text.success {
  color: var(--success);
}

.side-text.warning {
  color: var(--warning);
}

.side-text.danger {
  color: var(--error);
}

.label-chips,
.participants {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.label-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 11px;
  line-height: 17px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-state {
  flex: none;
  border-radius: 999px;
  padding: 0 6px;
  font-size: 10.5px;
  line-height: 16px;
  background: var(--bg-hover);
  color: var(--fg-muted);
}

.issue-state.open {
  background: rgba(88, 124, 12, 0.16);
  color: var(--success);
}

.merge-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-muted);
  display: inline-block;
}

.dot.success {
  background: var(--success);
}

.dot.danger {
  background: var(--error);
}

.dot.warning {
  background: var(--warning);
}

.commits {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.commit {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.commit-icon {
  margin-top: 2px;
  color: var(--fg-muted);
}

.commit-main {
  min-width: 0;
}

.commit-headline {
  font-size: 13px;
  overflow-wrap: anywhere;
}

.commit-meta {
  display: flex;
  gap: 8px;
  color: var(--fg-muted);
  font-size: 11.5px;
}

.commit-meta .oid {
  font-family: var(--font-mono);
}

.checks {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checks-actions {
  display: flex;
  gap: 6px;
}

.check-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}

.check-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-state {
  color: var(--fg-muted);
  font-size: 11.5px;
}

.check-state.success {
  color: var(--success);
}

.check-state.danger {
  color: var(--error);
}

.check-state.warning {
  color: var(--warning);
}

.reviews {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reviews-title {
  color: var(--fg-muted);
  font-size: 11.5px;
}

.review-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}

.review-author {
  font-weight: 600;
}

.badge {
  border-radius: 999px;
  padding: 0 7px;
  font-size: 11px;
  line-height: 17px;
  background: var(--bg-hover);
  color: var(--fg-muted);
}

.badge.success {
  background: rgba(88, 124, 12, 0.16);
  color: var(--success);
}

.badge.danger {
  background: rgba(173, 7, 7, 0.14);
  color: var(--error);
}

.muted {
  color: var(--fg-muted);
  font-size: 11.5px;
}

.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--fg-muted);
}
</style>
