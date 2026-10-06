<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { NDropdown, NIcon, useMessage } from "naive-ui";
import {
  ChatbubbleOutline,
  CheckmarkCircleOutline,
  ChevronDownOutline,
  CloseCircleOutline,
  CopyOutline,
  GitMerge,
  OpenOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import GitPullRequestIcon from "@renderer/components/icons/GitPullRequestIcon.vue";
import type {
  PullRequestDetail,
  PullRequestLabel,
  PullRequestSummary,
} from "../../../shared/github-types";
import GitHubAvatar from "@renderer/components/GitHubAvatar.vue";
import PullRequestDetailView from "@renderer/components/PullRequestDetailView.vue";
import PullRequestFilterBar from "@renderer/components/PullRequestFilterBar.vue";
import { usePullRequestsStore } from "@renderer/stores/pull-requests";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { formatPullRequestRelative } from "@renderer/utils/pull-request-format";
import { t } from "@renderer/i18n";

type PrView = "all" | "mine" | "reviewing" | "assigned" | "mentioned";

const PREFETCH_DELAY_MS = 300;
const detailPrefetch = new Map<string, number>();

const workspace = useWorkspaceStore();
const store = usePullRequestsStore();
const message = useMessage();

const search = ref(store.selection.filters.text ?? "");
const openUrl = ref<string | null>(null);
const highlighted = ref(-1);
const listEl = ref<HTMLElement | null>(null);
const listScrollTop = ref(0);
let prefetchTimer = 0;

const list = computed(() => store.list);
const rows = computed(() => list.value.pullRequests);
const hasWorkspace = computed(() => Boolean(workspace.root));

const view = computed<PrView>(() => {
  const filters = store.selection.filters;
  if (filters.reviewRequested === "@me") return "reviewing";
  if (filters.assignee === "@me") return "assigned";
  if (filters.mentions === "@me") return "mentioned";
  return store.selection.author === "mine" ? "mine" : "all";
});

const viewItems = computed<MenuItem[]>(() => [
  { key: "all", label: t.prViewAll },
  { key: "mine", label: t.prViewMine },
  { key: "reviewing", label: t.prViewReviewing },
  { key: "assigned", label: t.prViewAssigned },
  { key: "mentioned", label: t.prViewMentioned },
]);

const viewLabel = computed(() => viewItems.value.find((item) => item.key === view.value)?.label ?? "");

const stateTabs = computed(() => [
  { key: "open" as const, label: t.prStateOpen, count: list.value.counts?.open },
  { key: "closed" as const, label: t.prStateClosed, count: list.value.counts?.closed },
  { key: "merged" as const, label: t.prStateMerged, count: list.value.counts?.merged },
  { key: "all" as const, label: t.prStateAll, count: undefined },
]);


type MenuItem = { key: string; label: string };

const sortItems = computed<MenuItem[]>(() => [
  { key: "updated-desc", label: t.prSortUpdatedDesc },
  { key: "updated-asc", label: t.prSortUpdatedAsc },
  { key: "created-desc", label: t.prSortCreatedDesc },
  { key: "created-asc", label: t.prSortCreatedAsc },
  { key: "comments-desc", label: t.prSortCommentsDesc },
  { key: "comments-asc", label: t.prSortCommentsAsc },
  { key: "reactions-desc", label: t.prSortReactionsDesc },
  { key: "interactions-desc", label: t.prSortInteractionsDesc },
]);

const sortLabel = computed(
  () =>
    sortItems.value.find((item) => item.key === (store.selection.filters.sort ?? "updated-desc"))?.label ?? "",
);

type FilterChip = { key: keyof typeof store.selection.filters; label: string };

const chips = computed<FilterChip[]>(() => {
  const filters = store.selection.filters;
  const entries: FilterChip[] = [];
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key === "sort" || value === undefined || value === "" || value === false) continue;
    if (Array.isArray(value)) {
      for (const item of value) entries.push({ key: key as FilterChip["key"], label: `${key}: ${item}` });
      continue;
    }
    if (key === "reviewRequested" && value === "@me") text[key] = t.prViewReviewing;
    else if (key === "assignee" && value === "@me") text[key] = t.prViewAssigned;
    else if (key === "mentions" && value === "@me") text[key] = t.prViewMentioned;
    else text[key] = `${key}: ${String(value)}`;
  }
  for (const [key, label] of Object.entries(text)) entries.push({ key: key as FilterChip["key"], label });
  return entries;
});


function setFilter(key: Parameters<typeof store.setFilter>[0], value: unknown): void {
  store.setFilter(key, (value === "" ? undefined : value) as never);
}

function selectView(next: PrView): void {
  const filters = { ...store.selection.filters };
  delete filters.reviewRequested;
  delete filters.assignee;
  delete filters.mentions;
  if (next === "reviewing") {
    store.setSelection({ author: "all", filters: { ...filters, reviewRequested: "@me" } });
    return;
  }
  if (next === "assigned") {
    store.setSelection({ author: "all", filters: { ...filters, assignee: "@me" } });
    return;
  }
  if (next === "mentioned") {
    store.setSelection({ author: "all", filters: { ...filters, mentions: "@me" } });
    return;
  }
  store.setSelection({ author: next === "mine" ? "mine" : "all", filters });
}

function selectState(state: (typeof stateTabs.value)[number]["key"]): void {
  store.setSelection({ state });
}

function submitSearch(): void {
  store.setFilter("text", search.value.trim() || undefined);
}


function removeChip(chip: FilterChip): void {
  store.setFilter(chip.key, undefined);
}

function onRefresh(): void {
  if (!hasWorkspace.value) {
    message.warning(t.prOpenProject);
    return;
  }
  store.refresh();
}

function relativeTime(iso: string | undefined): string {
  return formatPullRequestRelative(iso);
}

function stateIcon(row: PullRequestSummary) {
  if (row.state === "merged") return GitMerge;
  if (row.state === "closed") return CloseCircleOutline;
  return GitPullRequestIcon;
}

function stateClass(row: PullRequestSummary): string {
  if (row.state === "merged") return "merged";
  if (row.state === "closed") return "closed";
  return row.isDraft ? "draft" : "open";
}

function checksInfo(row: PullRequestSummary): { text: string; tone: string } | null {
  const checks = row.checks ?? [];
  if (checks.length === 0) return null;
  if (checks.some((check) => check.state === "failure")) return { text: t.prChecksFailing, tone: "danger" };
  if (checks.some((check) => check.state === "pending")) return { text: t.prChecksRunning, tone: "warning" };
  if (checks.every((check) => check.state === "none")) return { text: t.prNoChecks, tone: "muted" };
  return { text: t.prChecksPassing, tone: "success" };
}

function reviewInfo(row: PullRequestSummary): { text: string; tone: string } | null {
  if (row.reviewDecision === "approved") return { text: t.prReviewApproved, tone: "success" };
  if (row.reviewDecision === "changes-requested") return { text: t.prReviewChangesRequested, tone: "danger" };
  if (row.reviewDecision === "review-required") return { text: t.prReviewRequired, tone: "warning" };
  return null;
}

function labelStyle(label: PullRequestLabel): Record<string, string> {
  return { borderColor: `#${label.color}`, color: `#${label.color}` };
}

function openDetail(row: PullRequestSummary): void {
  listScrollTop.value = listEl.value?.scrollTop ?? listScrollTop.value;
  openUrl.value = row.url;
  highlighted.value = -1;
}

function closeDetail(): void {
  openUrl.value = null;
  void nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listScrollTop.value;
  });
}

function prefetch(row: PullRequestSummary): void {
  window.clearTimeout(prefetchTimer);
  prefetchTimer = window.setTimeout(() => {
    const at = detailPrefetch.get(row.url);
    if (at && Date.now() - at < 60_000) return;
    detailPrefetch.set(row.url, Date.now());
    void window.api.github.pullRequestDetail({ url: row.url }).then((response) => {
      if (!response.success) return;
      const detail = response.detail as PullRequestDetail;
      void detail;
    });
  }, PREFETCH_DELAY_MS);
}

function copyLink(row: PullRequestSummary): void {
  void navigator.clipboard.writeText(row.url).then(
    () => message.success(t.prCopiedLink),
    () => message.error(t.prCouldNotLoadFiles),
  );
}

function openOnGithub(row: PullRequestSummary): void {
  void window.api.browser.openExternal(row.url);
}

function moveHighlight(step: number): void {
  if (rows.value.length === 0) return;
  const next = highlighted.value < 0 ? (step > 0 ? 0 : rows.value.length - 1) : highlighted.value + step;
  highlighted.value = Math.max(0, Math.min(rows.value.length - 1, next));
}

function onKeydown(event: KeyboardEvent): void {
  if (openUrl.value) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  ) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "ArrowDown" || event.key === "j") {
    event.preventDefault();
    moveHighlight(1);
    return;
  }
  if (event.key === "ArrowUp" || event.key === "k") {
    event.preventDefault();
    moveHighlight(-1);
    return;
  }
  if (event.key === "Enter") {
    const row = rows.value[highlighted.value];
    if (!row) return;
    event.preventDefault();
    openDetail(row);
  }
}

onMounted(() => {
  if (hasWorkspace.value) void store.load();
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.clearTimeout(prefetchTimer);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <section class="pr-page">
    <PullRequestDetailView v-if="openUrl" :url="openUrl" @back="closeDetail" />

    <template v-else>
      <header class="page-head">
        <h1 class="page-title">{{ t.pullRequests }}</h1>
        <span v-if="list.repository" class="repo-name">{{ list.repository }}</span>
        <div class="head-tools">
          <NDropdown
            trigger="click"
            :options="viewItems"
            @select="(key: string) => selectView(key as PrView)"
          >
            <button type="button" class="view-btn" :aria-label="t.prShowView(viewLabel)">
              <span>{{ viewLabel }}</span>
              <NIcon :component="ChevronDownOutline" :size="14" class="chev" />
            </button>
          </NDropdown>
          <form class="search-box" @submit.prevent="submitSearch">
            <NIcon :component="SearchOutline" :size="14" class="search-icon" />
            <input
              v-model="search"
              class="search-input"
              type="search"
              :placeholder="t.prSearchPlaceholder"
              @blur="submitSearch"
            />
          </form>
          <button type="button" class="icon-btn" :disabled="list.loading" :title="t.prRefresh" @click="onRefresh">
            <NIcon :component="RefreshOutline" :size="15" :class="{ spinning: list.loading }" />
          </button>
        </div>
      </header>

      <div class="tabs-row">
        <div class="state-tabs" role="tablist" :aria-label="t.prFilterState">
          <button
            v-for="tab in stateTabs"
            :key="tab.key"
            type="button"
            role="tab"
            class="state-tab"
            :aria-selected="store.selection.state === tab.key"
            :class="{ active: store.selection.state === tab.key }"
            @click="selectState(tab.key)"
          >
            {{ tab.label }}
            <span v-if="tab.count !== undefined" class="count">{{ tab.count }}</span>
          </button>
        </div>
        <div class="tabs-tools">
          <PullRequestFilterBar />
          <NDropdown
            trigger="click"
            :options="sortItems"
            @select="(key: string) => setFilter('sort', key)"
          >
            <button type="button" class="sort-btn" :aria-label="t.prSortBy(sortLabel)">
              <span>{{ sortLabel }}</span>
              <NIcon :component="ChevronDownOutline" :size="12" />
            </button>
          </NDropdown>
        </div>
      </div>

      <div v-if="chips.length" class="chips">
        <button v-for="chip in chips" :key="`${String(chip.key)}-${chip.label}`" type="button" class="chip" @click="removeChip(chip)">
          {{ chip.label }}
          <span aria-hidden="true">×</span>
        </button>
        <button type="button" class="chip clear" @click="store.clearFilters()">{{ t.prClearFilters }}</button>
      </div>


      <div ref="listEl" class="list">
        <div v-if="!hasWorkspace" class="empty">
          <div class="empty-title">{{ t.prOpenProject }}</div>
          <div class="empty-hint">{{ t.prNoPullRequestsHint }}</div>
        </div>
        <div v-else-if="list.error && rows.length === 0" class="alert error">
          <p>{{ list.error }}</p>
          <button type="button" class="link-btn" @click="onRefresh">{{ t.prRefresh }}</button>
        </div>
        <template v-else>
          <div v-if="list.error" class="alert error compact">
            <span class="ellipsis">{{ list.error }}</span>
            <span class="muted">{{ t.prShowingLastLoaded }}</span>
          </div>
          <div v-if="list.loading && rows.length === 0" class="skeleton">
            <div v-for="index in 6" :key="index" class="skeleton-row">
              <span class="skeleton-dot" />
              <span class="skeleton-line" />
              <span class="skeleton-line short" />
            </div>
          </div>
          <div v-else-if="rows.length === 0" class="empty">
            <div class="empty-title">{{ t.prNoPullRequests }}</div>
            <div class="empty-hint">
              {{ chips.length ? t.prNoMatchesHintFilters : t.prNoPullRequestsHint }}
            </div>
            <button v-if="chips.length" type="button" class="link-btn" @click="store.clearFilters()">
              {{ t.prClearFilters }}
            </button>
          </div>
          <template v-else>
            <div class="list-summary">
              <span v-if="list.totalCount">{{ t.prTotal(list.totalCount) }}</span>
              <span class="spacer" />
              <span v-if="list.nextCursor">{{ t.prShowingCount(rows.length, list.totalCount) }}</span>
            </div>
            <ul class="pr-list" :aria-label="t.pullRequests">
              <li
                v-for="(row, index) in rows"
                :key="row.url"
                class="pr-row"
                :class="{ highlighted: index === highlighted }"
                @click="openDetail(row)"
                @pointerenter="prefetch(row)"
              >
                <NIcon :component="stateIcon(row)" :size="16" class="state-icon" :class="stateClass(row)" />
                <div class="row-main">
                  <div class="row-title-line">
                    <span class="row-title">
                      {{ row.title }}
                      <span class="row-number">#{{ row.number }}</span>
                    </span>
                  </div>
                  <div class="row-sub">
                    <span v-if="row.isDraft" class="draft-tag">{{ t.prDraft }}</span>
                    <span v-if="row.headBranch" class="row-branch">
                      <span class="branch-pill">{{ row.headBranch }}</span>
                      <span v-if="row.baseBranch" class="arrow">→</span>
                      <span v-if="row.baseBranch" class="branch-pill">{{ row.baseBranch }}</span>
                    </span>
                    <span v-if="row.commentCount" class="row-meta-item">
                      <NIcon :component="ChatbubbleOutline" :size="13" />{{ row.commentCount }}
                    </span>
                    <span v-if="row.assignees?.length" class="row-people">
                      <GitHubAvatar
                        v-for="person in row.assignees"
                        :key="person.login"
                        :login="person.login"
                        :src="person.avatarUrl"
                        size="sm"
                      />
                    </span>
                    <span class="row-inline">
                      <span v-if="row.author" class="row-author-inline">{{ row.author }}</span>
                      <span v-if="checksInfo(row)" class="badge" :class="checksInfo(row)?.tone">{{ checksInfo(row)?.text }}</span>
                      <span v-if="reviewInfo(row)" class="badge" :class="reviewInfo(row)?.tone">{{ reviewInfo(row)?.text }}</span>
                    </span>
                  </div>
                </div>
                <div class="row-author">
                  <span v-if="row.author" class="author-cell">
                    <GitHubAvatar :login="row.author" :src="row.authorAvatarUrl" size="md" />
                    <span class="ellipsis">{{ row.author }}</span>
                  </span>
                  <span v-else class="muted">—</span>
                </div>
                <div class="row-checks">
                  <span v-if="checksInfo(row)" class="badge" :class="checksInfo(row)?.tone">
                    <NIcon :component="CheckmarkCircleOutline" :size="12" />{{ checksInfo(row)?.text }}
                  </span>
                  <span v-else class="muted">—</span>
                </div>
                <div class="row-labels">
                  <span v-if="row.labels?.length" class="label-chips">
                    <span v-for="label in row.labels" :key="label.name" class="label-chip" :style="labelStyle(label)">
                      {{ label.name }}
                    </span>
                  </span>
                  <span v-else class="muted">—</span>
                </div>
                <div class="row-diff">
                  <span v-if="row.additions !== undefined && row.deletions !== undefined">
                    <span class="added">{{ t.prAdditionsCount(row.additions) }}</span>
                    <span class="removed">{{ t.prDeletionsCount(row.deletions) }}</span>
                  </span>
                  <span v-else class="muted">—</span>
                </div>
                <div class="row-time">
                  <span class="time-text">{{ relativeTime(row.updatedAt ?? row.createdAt) }}</span>
                  <span class="row-actions">
                    <button type="button" class="row-action" :title="t.prCopyLink" @click.stop="copyLink(row)">
                      <NIcon :component="CopyOutline" :size="13" />
                    </button>
                    <button type="button" class="row-action" :title="t.prOpenOnGithub" @click.stop="openOnGithub(row)">
                      <NIcon :component="OpenOutline" :size="13" />
                    </button>
                  </span>
                </div>
              </li>
            </ul>
            <div class="list-foot">
              <p v-if="list.moreError" class="more-error">{{ list.moreError }}</p>
              <button
                v-if="list.nextCursor"
                type="button"
                class="load-more"
                :disabled="list.loadingMore"
                @click="store.loadMore()"
              >
                {{ t.prLoadMore }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </template>
  </section>
</template>

<style scoped>
.pr-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow-y: auto;
  background: var(--bg);
  color: var(--fg);
  font-size: 13px;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px 0;
  min-width: 0;
}

@media (min-width: 1024px) {
  .page-head {
    padding: 20px 40px 0;
  }
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  white-space: nowrap;
}

.repo-name {
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.view-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg-strong);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.view-btn:hover {
  background: rgba(127, 127, 127, 0.04);
}

.view-btn .chev {
  color: var(--fg-muted);
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: min(300px, 26vw);
}

.search-icon {
  position: absolute;
  left: 8px;
  color: var(--fg-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 28px;
  padding: 0 10px 0 28px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--fg);
  font-size: 12.5px;
  outline: none;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--fg-muted);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.tabs-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 24px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

@media (min-width: 1024px) {
  .tabs-row {
    margin: 16px 40px 0;
  }
}

.state-tabs {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
}

.state-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  border: 0;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  color: var(--fg-muted);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.state-tab:hover {
  color: var(--fg);
}

.state-tab.active {
  color: var(--fg-strong);
  font-weight: 600;
}

.state-tab .count {
  color: var(--fg-muted);
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.tabs-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
}

.sort-btn:hover {
  background: rgba(127, 127, 127, 0.07);
  color: var(--fg);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 24px 0;
}

@media (min-width: 1024px) {
  .chips {
    margin: 8px 40px 0;
  }
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  padding: 1px 9px;
  background: transparent;
  color: var(--fg);
  font-size: 11.5px;
  cursor: pointer;
}

.chip:hover {
  background: var(--bg-hover);
}

.chip.clear {
  border-style: dashed;
  color: var(--fg-muted);
}

.list {
  flex: 1;
  min-height: 0;
  padding: 8px 24px 48px;
}

@media (min-width: 1024px) {
  .list {
    padding: 8px 40px 48px;
  }
}

.list-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--fg-muted);
  padding: 4px 0 8px;
}

.list-summary .spacer {
  flex: 1;
}

.pr-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.pr-row {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr) 6.5rem 4.5rem;
  align-items: center;
  gap: 0 1rem;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.pr-row:hover {
  background: rgba(127, 127, 127, 0.03);
}

.pr-row.highlighted {
  background: rgba(127, 127, 127, 0.05);
}

@media (min-width: 1280px) {
  .pr-row {
    grid-template-columns: 1rem minmax(0, 1fr) 9rem 7.5rem 9.5rem 6.5rem 5rem;
  }
}

@media (max-width: 1279px) {
  .row-checks,
  .row-labels,
  .row-diff {
    display: none;
  }

  .row-inline {
    display: inline-flex;
  }
}

.state-icon {
  margin-top: 0;
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

.row-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.row-title {
  min-width: 0;
  color: var(--fg);
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-number {
  margin-left: 6px;
  color: var(--fg-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.row-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--fg-muted);
  font-size: 11.5px;
  min-width: 0;
}

.draft-tag {
  border-radius: var(--radius-sm);
  padding: 0 6px;
  background: rgba(127, 127, 127, 0.14);
  color: var(--fg-muted);
  font-size: 11px;
}

.row-branch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  min-width: 0;
}

.branch-pill {
  border-radius: var(--radius-sm);
  padding: 0 5px;
  background: rgba(127, 127, 127, 0.1);
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.row-people {
  display: inline-flex;
  gap: 3px;
}

.mini-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-hover);
}

.mini-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.row-inline {
  display: none;
  align-items: center;
  gap: 8px;
}

.row-author,
.row-checks,
.row-labels,
.row-diff,
.row-time {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11.5px;
}

.row-checks {
  justify-content: flex-start;
}

.row-labels .label-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
}

.label-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 6px;
  font-size: 10.5px;
  line-height: 16px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-diff {
  justify-content: flex-end;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.row-diff .added {
  color: var(--diff-added);
}

.row-diff .removed {
  color: var(--diff-removed);
}

.row-time {
  position: relative;
  justify-content: flex-end;
  color: var(--fg-muted);
  white-space: nowrap;
}

.row-actions {
  position: absolute;
  right: 0;
  display: none;
  align-items: center;
  gap: 2px;
}

.pr-row:hover .row-actions,
.pr-row.highlighted .row-actions {
  display: inline-flex;
}

.pr-row:hover .time-text,
.pr-row.highlighted .time-text {
  visibility: hidden;
}

.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.row-action:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 10.5px;
  line-height: 17px;
  background: rgba(127, 127, 127, 0.1);
  color: var(--fg-muted);
  white-space: nowrap;
}

.badge.success {
  background: rgba(88, 124, 12, 0.14);
  color: var(--success);
}

.badge.danger {
  background: rgba(173, 7, 7, 0.14);
  color: var(--error);
}

.badge.warning {
  background: rgba(191, 136, 3, 0.16);
  color: var(--warning);
}

.muted {
  color: var(--fg-muted);
}

.list-foot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.load-more {
  height: 36px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
}

.load-more:hover {
  background: var(--bg-hover);
}

.load-more:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.more-error {
  margin: 0;
  color: var(--error);
  font-size: 12.5px;
}

.empty {
  padding: 40px 16px;
  text-align: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg-muted);
}

.empty-title {
  font-size: 14px;
  color: var(--fg);
}

.empty-hint {
  margin-top: 4px;
  font-size: 13px;
}

.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid rgba(173, 7, 7, 0.3);
  border-radius: var(--radius-md);
  background: rgba(173, 7, 7, 0.06);
  font-size: 12.5px;
}

.alert.compact {
  padding: 6px 10px;
}

.alert p {
  margin: 0;
}

.link-btn {
  border: 0;
  background: transparent;
  color: var(--fg);
  text-decoration: underline;
  cursor: pointer;
  font-size: 12.5px;
}

.skeleton {
  display: flex;
  flex-direction: column;
}

.skeleton-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 160px;
  gap: 10px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.skeleton-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(127, 127, 127, 0.12);
}

.skeleton-line {
  height: 12px;
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.12);
}

.skeleton-line.short {
  width: 60%;
}
</style>
