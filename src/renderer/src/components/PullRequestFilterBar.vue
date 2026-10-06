<script setup lang="ts">
import { computed, ref } from "vue";
import { NIcon, NPopover, NSpin } from "naive-ui";
import { CheckmarkOutline, ChevronDownOutline, SearchOutline } from "@vicons/ionicons5";
import type {
  PullRequestChoices,
  PullRequestFilters,
  PullRequestLabel,
  PullRequestMilestone,
} from "../../../shared/github-types";
import { usePullRequestsStore } from "@renderer/stores/pull-requests";
import { t } from "@renderer/i18n";

const store = usePullRequestsStore();

type FilterOption = { value: string; label: string; section?: string; color?: string; hint?: string };

type FilterControl = {
  key: string;
  label: string;
  title: string;
  multi: boolean;
  searchable: boolean;
  active: string | null;
  count: number;
  options: FilterOption[];
  selected: string[];
  loading: boolean;
  error: string | null;
  ensureLoaded?: () => void;
  toggle: (value: string, on: boolean) => void;
  clear: () => void;
};

const NO_LABEL = "\u0000none";
const NO_MILESTONE = "none";

const choices = ref<PullRequestChoices>({});
const loadingKinds = ref<Set<string>>(new Set());
const errors = ref<Record<string, string | null>>({});
const query = ref<Record<string, string>>({});

const filters = computed(() => store.selection.filters);

async function ensure(kind: "people" | "labels" | "milestones" | "branches"): Promise<void> {
  const loaded =
    (kind === "people" && choices.value.people) ||
    (kind === "labels" && choices.value.labels) ||
    (kind === "milestones" && choices.value.milestones) ||
    (kind === "branches" && choices.value.branches);
  if (loaded || loadingKinds.value.has(kind)) return;
  const next = new Set(loadingKinds.value);
  next.add(kind);
  loadingKinds.value = next;
  try {
    const response = await window.api.github.repositoryChoices({ kind });
    if (!response.success) {
      errors.value = { ...errors.value, [kind]: response.error };
      return;
    }
    choices.value = {
      ...choices.value,
      ...(kind === "people" ? { people: response.people ?? [] } : {}),
      ...(kind === "labels" ? { labels: response.labels ?? [] } : {}),
      ...(kind === "milestones" ? { milestones: response.milestones ?? [] } : {}),
      ...(kind === "branches" ? { branches: response.branches ?? [] } : {}),
    };
    errors.value = { ...errors.value, [kind]: null };
  } finally {
    const settled = new Set(loadingKinds.value);
    settled.delete(kind);
    loadingKinds.value = settled;
  }
}

function update(patch: Partial<PullRequestFilters>, clear: (keyof PullRequestFilters)[] = []): void {
  const next: PullRequestFilters = { ...store.selection.filters };
  for (const key of clear) delete next[key];
  Object.assign(next, patch);
  store.setSelection({ filters: next });
}

function toggleValue(key: keyof PullRequestFilters, value: string | number | boolean, on: boolean): void {
  update(on ? ({ [key]: value } as Partial<PullRequestFilters>) : {}, on ? [] : [key]);
}

function displayValue(value: string): string {
  if (value === "@me") return t.prMe;
  if (value === "none") return t.prNoneOption;
  return value;
}

function peopleOptions(): FilterOption[] {
  const rest = (choices.value.people ?? []).map((login) => ({ value: login, label: login }));
  return [{ value: "@me", label: t.prMe }, ...rest];
}

const reviewOptions = computed<FilterOption[]>(() => [
  { value: "none", label: t.prFilterNoneReview },
  { value: "required", label: t.prReviewRequired },
  { value: "approved", label: t.prReviewApproved },
  { value: "changes-requested", label: t.prReviewChangesRequested },
]);

const checksOptions = computed<FilterOption[]>(() => [
  { value: "success", label: t.prChecksPassing },
  { value: "failure", label: t.prChecksFailing },
  { value: "pending", label: t.prChecksRunning },
]);

const moreItems = computed(() => [
  { value: "draft", label: t.prMoreDraftsOnly, on: filters.value.draft === true },
  { value: "ready", label: t.prMoreReadyOnly, on: filters.value.draft === false },
  { value: "linked", label: t.prMoreLinkedIssue, on: filters.value.linked === "issue" },
  { value: "commented", label: t.prMoreCommentedByMe, on: filters.value.commenter === "@me" },
  { value: "involves", label: t.prMoreInvolvesMe, on: filters.value.involves === "@me" },
  { value: "reviewed", label: t.prMoreReviewedByMe, on: filters.value.reviewedBy === "@me" },
  { value: "week", label: t.prMoreUpdatedWeek, on: filters.value.updatedWithin === 7 },
  { value: "month", label: t.prMoreUpdatedMonth, on: filters.value.updatedWithin === 30 },
]);

function toggleMore(value: string, on: boolean): void {
  if (value === "draft") return toggleValue("draft", true, on);
  if (value === "ready") return toggleValue("draft", false, on);
  if (value === "linked") return toggleValue("linked", "issue", on);
  if (value === "commented") return toggleValue("commenter", "@me", on);
  if (value === "involves") return toggleValue("involves", "@me", on);
  if (value === "reviewed") return toggleValue("reviewedBy", "@me", on);
  if (value === "week") return toggleValue("updatedWithin", 7, on);
  if (value === "month") return toggleValue("updatedWithin", 30, on);
}

const controls = computed<FilterControl[]>(() => [
  {
    key: "author",
    label: t.prFilterAuthor,
    title: t.prFilterAuthor,
    multi: false,
    searchable: true,
    active: filters.value.author ? displayValue(filters.value.author) : null,
    count: 0,
    options: peopleOptions(),
    selected: filters.value.author ? [filters.value.author] : [],
    loading: loadingKinds.value.has("people"),
    error: errors.value.people ?? null,
    ensureLoaded: () => void ensure("people"),
    toggle: (value, on) => toggleValue("author", value, on),
    clear: () => update({}, ["author"]),
  },
  {
    key: "labels",
    label: t.prFilterLabel,
    title: t.prFilterLabel,
    multi: true,
    searchable: true,
    active: filters.value.labels?.length || filters.value.noLabel ? String((filters.value.labels?.length ?? 0) + (filters.value.noLabel ? 1 : 0)) : null,
    count: (filters.value.labels?.length ?? 0) + (filters.value.noLabel ? 1 : 0),
    options: [
      { value: NO_LABEL, label: t.prFilterNoLabel, section: t.prFilterSuggestions },
      ...(choices.value.labels ?? []).map((label: PullRequestLabel) => ({
        value: label.name,
        label: label.name,
        color: label.color,
        section: t.prFilterLabelsSection,
      })),
    ],
    selected: [...(filters.value.labels ?? []), ...(filters.value.noLabel ? [NO_LABEL] : [])],
    loading: loadingKinds.value.has("labels"),
    error: errors.value.labels ?? null,
    ensureLoaded: () => void ensure("labels"),
    toggle: (value, on) => {
      if (value === NO_LABEL) {
        update(on ? { noLabel: true } : {}, on ? ["labels"] : ["noLabel"]);
        return;
      }
      const current = filters.value.labels ?? [];
      const next = on ? [...current.filter((item) => item !== value), value] : current.filter((item) => item !== value);
      update(next.length ? { labels: next } : {}, next.length ? ["noLabel"] : ["labels", "noLabel"]);
    },
    clear: () => update({}, ["labels", "noLabel"]),
  },
  {
    key: "assignee",
    label: t.prFilterAssignee,
    title: t.prFilterAssignee,
    multi: false,
    searchable: true,
    active: filters.value.assignee ? displayValue(filters.value.assignee) : null,
    count: 0,
    options: [
      { value: "@me", label: t.prMe },
      { value: "none", label: t.prFilterNoAssignee },
      ...(choices.value.people ?? []).map((login) => ({ value: login, label: login })),
    ],
    selected: filters.value.assignee ? [filters.value.assignee] : [],
    loading: loadingKinds.value.has("people"),
    error: errors.value.people ?? null,
    ensureLoaded: () => void ensure("people"),
    toggle: (value, on) => toggleValue("assignee", value, on),
    clear: () => update({}, ["assignee"]),
  },
  {
    key: "review",
    label: t.prFilterReview,
    title: t.prFilterReview,
    multi: false,
    searchable: false,
    active: filters.value.review ? reviewOptions.value.find((option) => option.value === filters.value.review)?.label ?? null : null,
    count: 0,
    options: reviewOptions.value,
    selected: filters.value.review ? [filters.value.review] : [],
    loading: false,
    error: null,
    toggle: (value, on) => toggleValue("review", value, on),
    clear: () => update({}, ["review"]),
  },
  {
    key: "checks",
    label: t.prFilterChecks,
    title: t.prFilterChecks,
    multi: false,
    searchable: false,
    active: filters.value.checks && filters.value.checks !== "none"
      ? checksOptions.value.find((option) => option.value === filters.value.checks)?.label ?? null
      : null,
    count: 0,
    options: checksOptions.value,
    selected: filters.value.checks ? [filters.value.checks] : [],
    loading: false,
    error: null,
    toggle: (value, on) => toggleValue("checks", value, on),
    clear: () => update({}, ["checks"]),
  },
  {
    key: "milestone",
    label: t.prFilterMilestone,
    title: t.prFilterMilestone,
    multi: false,
    searchable: true,
    active: filters.value.milestone ? displayValue(filters.value.milestone) : null,
    count: 0,
    options: [
      { value: NO_MILESTONE, label: t.prFilterNoMilestone, section: t.prFilterSuggestions },
      ...(choices.value.milestones ?? []).map((milestone: PullRequestMilestone) => ({
        value: milestone.title,
        label: milestone.title,
        section: t.prFilterOpenMilestones,
        ...(milestone.dueOn ? { hint: milestone.dueOn.slice(0, 10) } : {}),
      })),
    ],
    selected: filters.value.milestone ? [filters.value.milestone] : [],
    loading: loadingKinds.value.has("milestones"),
    error: errors.value.milestones ?? null,
    ensureLoaded: () => void ensure("milestones"),
    toggle: (value, on) => toggleValue("milestone", value, on),
    clear: () => update({}, ["milestone"]),
  },
  {
    key: "base",
    label: t.prFilterBase,
    title: t.prFilterBase,
    multi: false,
    searchable: true,
    active: filters.value.base ?? null,
    count: 0,
    options: (choices.value.branches ?? []).map((branch, index) => ({
      value: branch,
      label: branch,
      section: index === 0 ? t.prFilterDefaultBranch : t.prFilterBranchesSection,
    })),
    selected: filters.value.base ? [filters.value.base] : [],
    loading: loadingKinds.value.has("branches"),
    error: errors.value.branches ?? null,
    ensureLoaded: () => void ensure("branches"),
    toggle: (value, on) => toggleValue("base", value, on),
    clear: () => update({}, ["base"]),
  },
  {
    key: "more",
    label: t.prFilterMore,
    title: t.prFilterMore,
    multi: true,
    searchable: false,
    active: moreItems.value.some((item) => item.on) ? String(moreItems.value.filter((item) => item.on).length) : null,
    count: moreItems.value.filter((item) => item.on).length,
    options: moreItems.value.map((item) => ({ value: item.value, label: item.label })),
    selected: moreItems.value.filter((item) => item.on).map((item) => item.value),
    loading: false,
    error: null,
    toggle: toggleMore,
    clear: () => update({}, ["draft", "linked", "commenter", "involves", "reviewedBy", "updatedWithin", "createdAfter", "updatedAfter", "head"]),
  },
]);

function visibleOptions(control: FilterControl): FilterOption[] {
  const text = (query.value[control.key] ?? "").trim().toLowerCase();
  if (!text) return control.options;
  return control.options.filter(
    (option) => option.label.toLowerCase().includes(text) || option.value.toLowerCase().includes(text),
  );
}

function sectionOf(index: number, list: FilterOption[]): string | null {
  const current = list[index]?.section;
  if (!current) return null;
  return list[index - 1]?.section === current ? null : current;
}

function onOpen(control: FilterControl): void {
  query.value = { ...query.value, [control.key]: "" };
  control.ensureLoaded?.();
}
</script>

<template>
  <div class="filter-bar" role="toolbar" :aria-label="t.prFilters">
    <NPopover
      v-for="control in controls"
      :key="control.key"
      trigger="click"
      placement="bottom-end"
      :show-arrow="false"
      :content-style="{ padding: '0', width: '288px' }"
      @update:show="(show: boolean) => show && onOpen(control)"
    >
      <template #trigger>
        <button
          type="button"
          class="filter-btn"
          :class="{ active: control.active !== null }"
          :aria-label="control.active ? `${control.label}: ${control.active}` : control.label"
        >
          <span class="filter-label">{{ control.label }}</span>
          <span v-if="control.active !== null" class="filter-value">
            {{ control.multi && control.count > 1 ? control.count : control.active }}
          </span>
          <NIcon :component="ChevronDownOutline" :size="12" class="chev" />
        </button>
      </template>

      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">{{ t.prFilterBy(control.title) }}</span>
          <span v-if="control.multi && control.count > 0" class="panel-count">{{ t.prSelectedCount(control.count) }}</span>
        </div>
        <div v-if="control.searchable" class="panel-search">
          <NIcon :component="SearchOutline" :size="14" class="search-icon" />
          <input
            :value="query[control.key] ?? ''"
            :placeholder="t.prSearchFilter(control.label)"
            :aria-label="t.prSearchFilter(control.label)"
            @input="(event: Event) => (query = { ...query, [control.key]: (event.target as HTMLInputElement).value })"
          />
        </div>
        <div class="panel-list">
          <p v-if="control.error" class="panel-error">{{ control.error }}</p>
          <div v-else-if="control.loading && control.options.length === 0" class="panel-loading">
            <NSpin size="small" />
          </div>
          <p v-else-if="visibleOptions(control).length === 0" class="panel-empty">
            {{ t.prNoFilterMatches(query[control.key] ?? "") }}
          </p>
          <template v-else>
            <template v-for="(option, index) in visibleOptions(control)" :key="option.value">
              <p v-if="sectionOf(index, visibleOptions(control))" class="panel-section">
                {{ sectionOf(index, visibleOptions(control)) }}
              </p>
              <button
                type="button"
                class="panel-option"
                :aria-pressed="control.selected.includes(option.value)"
                @click="control.toggle(option.value, !control.selected.includes(option.value))"
              >
                <span
                  class="option-dot"
                  :style="option.color ? { background: `#${option.color}` } : undefined"
                  :class="{ hidden: !option.color }"
                />
                <span class="option-label">{{ option.label }}</span>
                <span v-if="option.hint" class="option-hint">{{ option.hint }}</span>
                <NIcon
                  :component="CheckmarkOutline"
                  :size="14"
                  class="option-check"
                  :class="{ on: control.selected.includes(option.value) }"
                />
              </button>
            </template>
          </template>
        </div>
        <div v-if="control.selected.length > 0" class="panel-foot">
          <button type="button" class="clear-btn" @click="control.clear()">{{ t.prClearFilter }}</button>
        </div>
      </div>
    </NPopover>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.filter-btn {
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

.filter-btn:hover {
  background: rgba(127, 127, 127, 0.07);
  color: var(--fg);
}

.filter-btn.active {
  color: var(--fg);
  font-weight: 500;
}

.filter-label {
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-value {
  max-width: 7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 3px;
  background: var(--accent-soft);
  padding: 0 6px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  color: var(--accent);
}

.chev {
  flex: none;
  opacity: 0.6;
}

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 6px;
}

.panel-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg);
}

.panel-count {
  font-size: 11px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.panel-search {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 8px 6px;
}

.search-icon {
  position: absolute;
  left: 18px;
  color: var(--fg-muted);
  pointer-events: none;
}

.panel-search input {
  width: 100%;
  height: 32px;
  padding: 0 8px 0 30px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-size: 12px;
  outline: none;
}

.panel-list {
  max-height: 320px;
  overflow-y: auto;
  border-top: 1px solid var(--border);
  padding: 4px;
}

.panel-section {
  margin: 4px 0 2px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--fg-muted);
}

.panel-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.panel-option:hover {
  background: rgba(127, 127, 127, 0.08);
}

.option-dot {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(127, 127, 127, 0.3);
}

.option-dot.hidden {
  visibility: hidden;
}

.option-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-hint {
  flex: none;
  font-size: 11px;
  color: var(--fg-muted);
}

.option-check {
  flex: none;
  color: var(--accent);
  opacity: 0;
}

.option-check.on {
  opacity: 1;
}

.panel-loading,
.panel-empty,
.panel-error {
  padding: 12px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--fg-muted);
}

.panel-error {
  color: var(--error);
}

.panel-foot {
  border-top: 1px solid var(--border);
  padding: 4px;
}

.clear-btn {
  width: 100%;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
}

.clear-btn:hover {
  background: rgba(127, 127, 127, 0.08);
  color: var(--fg);
}
</style>
