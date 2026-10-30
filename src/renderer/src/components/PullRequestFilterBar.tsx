import { Fragment, useRef, useState, type ReactNode } from "react";
import { Popover, Spin } from "antd";
import { CheckmarkOutline, ChevronDownOutline, SearchOutline } from "@renderer/components/icons/ionicons";
import type {
  PullRequestChoices,
  PullRequestFilters,
  PullRequestLabel,
  PullRequestMilestone,
} from "../../../shared/github-types";
import { usePullRequestsStore } from "@renderer/stores/pull-requests";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PullRequestFilterBar.module.css";

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

const FILTER_POPOVER_STYLES = {
  container: {
    padding: 0,
    background: "transparent",
    border: "none",
    borderRadius: 12,
    boxShadow: "none",
  },
  content: { padding: 0, width: "288px" },
};

export function PullRequestFilterBar(): ReactNode {
  const t = useI18n();
  const store = usePullRequestsStore();
  const [choices, setChoices] = useState<PullRequestChoices>({});
  const [loadingKinds, setLoadingKinds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState<Record<string, string>>({});
  const loadingKindsRef = useRef<Set<string>>(new Set());

  const filters = store.selection.filters;

  async function ensure(kind: "people" | "labels" | "milestones" | "branches"): Promise<void> {
    const loaded =
      (kind === "people" && choices.people) ||
      (kind === "labels" && choices.labels) ||
      (kind === "milestones" && choices.milestones) ||
      (kind === "branches" && choices.branches);
    if (loaded || loadingKindsRef.current.has(kind)) return;
    const next = new Set(loadingKindsRef.current);
    next.add(kind);
    loadingKindsRef.current = next;
    setLoadingKinds(next);
    try {
      const response = await window.api.github.repositoryChoices({ kind });
      if (!response.success) {
        setErrors((current) => ({ ...current, [kind]: response.error }));
        return;
      }
      setChoices((current) => ({
        ...current,
        ...(kind === "people" ? { people: response.people ?? [] } : {}),
        ...(kind === "labels" ? { labels: response.labels ?? [] } : {}),
        ...(kind === "milestones" ? { milestones: response.milestones ?? [] } : {}),
        ...(kind === "branches" ? { branches: response.branches ?? [] } : {}),
      }));
      setErrors((current) => ({ ...current, [kind]: null }));
    } finally {
      const settled = new Set(loadingKindsRef.current);
      settled.delete(kind);
      loadingKindsRef.current = settled;
      setLoadingKinds(settled);
    }
  }

  function update(patch: Partial<PullRequestFilters>, clear: (keyof PullRequestFilters)[] = []): void {
    const next: PullRequestFilters = { ...usePullRequestsStore.getState().selection.filters };
    for (const key of clear) delete next[key];
    Object.assign(next, patch);
    usePullRequestsStore.getState().setSelection({ filters: next });
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
    const rest = (choices.people ?? []).map((login) => ({ value: login, label: login }));
    return [{ value: "@me", label: t.prMe }, ...rest];
  }

  const reviewOptions: FilterOption[] = [
    { value: "none", label: t.prFilterNoneReview },
    { value: "required", label: t.prReviewRequired },
    { value: "approved", label: t.prReviewApproved },
    { value: "changes-requested", label: t.prReviewChangesRequested },
  ];

  const checksOptions: FilterOption[] = [
    { value: "success", label: t.prChecksPassing },
    { value: "failure", label: t.prChecksFailing },
    { value: "pending", label: t.prChecksRunning },
  ];

  const moreItems = [
    { value: "draft", label: t.prMoreDraftsOnly, on: filters.draft === true },
    { value: "ready", label: t.prMoreReadyOnly, on: filters.draft === false },
    { value: "linked", label: t.prMoreLinkedIssue, on: filters.linked === "issue" },
    { value: "commented", label: t.prMoreCommentedByMe, on: filters.commenter === "@me" },
    { value: "involves", label: t.prMoreInvolvesMe, on: filters.involves === "@me" },
    { value: "reviewed", label: t.prMoreReviewedByMe, on: filters.reviewedBy === "@me" },
    { value: "week", label: t.prMoreUpdatedWeek, on: filters.updatedWithin === 7 },
    { value: "month", label: t.prMoreUpdatedMonth, on: filters.updatedWithin === 30 },
  ];

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

  const controls: FilterControl[] = [
    {
      key: "author",
      label: t.prFilterAuthor,
      title: t.prFilterAuthor,
      multi: false,
      searchable: true,
      active: filters.author ? displayValue(filters.author) : null,
      count: 0,
      options: peopleOptions(),
      selected: filters.author ? [filters.author] : [],
      loading: loadingKinds.has("people"),
      error: errors.people ?? null,
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
      active:
        filters.labels?.length || filters.noLabel
          ? String((filters.labels?.length ?? 0) + (filters.noLabel ? 1 : 0))
          : null,
      count: (filters.labels?.length ?? 0) + (filters.noLabel ? 1 : 0),
      options: [
        { value: NO_LABEL, label: t.prFilterNoLabel, section: t.prFilterSuggestions },
        ...(choices.labels ?? []).map((label: PullRequestLabel) => ({
          value: label.name,
          label: label.name,
          color: label.color,
          section: t.prFilterLabelsSection,
        })),
      ],
      selected: [...(filters.labels ?? []), ...(filters.noLabel ? [NO_LABEL] : [])],
      loading: loadingKinds.has("labels"),
      error: errors.labels ?? null,
      ensureLoaded: () => void ensure("labels"),
      toggle: (value, on) => {
        if (value === NO_LABEL) {
          update(on ? { noLabel: true } : {}, on ? ["labels"] : ["noLabel"]);
          return;
        }
        const current = filters.labels ?? [];
        const next = on
          ? [...current.filter((item) => item !== value), value]
          : current.filter((item) => item !== value);
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
      active: filters.assignee ? displayValue(filters.assignee) : null,
      count: 0,
      options: [
        { value: "@me", label: t.prMe },
        { value: "none", label: t.prFilterNoAssignee },
        ...(choices.people ?? []).map((login) => ({ value: login, label: login })),
      ],
      selected: filters.assignee ? [filters.assignee] : [],
      loading: loadingKinds.has("people"),
      error: errors.people ?? null,
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
      active: filters.review
        ? reviewOptions.find((option) => option.value === filters.review)?.label ?? null
        : null,
      count: 0,
      options: reviewOptions,
      selected: filters.review ? [filters.review] : [],
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
      active:
        filters.checks && filters.checks !== "none"
          ? checksOptions.find((option) => option.value === filters.checks)?.label ?? null
          : null,
      count: 0,
      options: checksOptions,
      selected: filters.checks ? [filters.checks] : [],
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
      active: filters.milestone ? displayValue(filters.milestone) : null,
      count: 0,
      options: [
        { value: NO_MILESTONE, label: t.prFilterNoMilestone, section: t.prFilterSuggestions },
        ...(choices.milestones ?? []).map((milestone: PullRequestMilestone) => ({
          value: milestone.title,
          label: milestone.title,
          section: t.prFilterOpenMilestones,
          ...(milestone.dueOn ? { hint: milestone.dueOn.slice(0, 10) } : {}),
        })),
      ],
      selected: filters.milestone ? [filters.milestone] : [],
      loading: loadingKinds.has("milestones"),
      error: errors.milestones ?? null,
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
      active: filters.base ?? null,
      count: 0,
      options: (choices.branches ?? []).map((branch, index) => ({
        value: branch,
        label: branch,
        section: index === 0 ? t.prFilterDefaultBranch : t.prFilterBranchesSection,
      })),
      selected: filters.base ? [filters.base] : [],
      loading: loadingKinds.has("branches"),
      error: errors.branches ?? null,
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
      active: moreItems.some((item) => item.on) ? String(moreItems.filter((item) => item.on).length) : null,
      count: moreItems.filter((item) => item.on).length,
      options: moreItems.map((item) => ({ value: item.value, label: item.label })),
      selected: moreItems.filter((item) => item.on).map((item) => item.value),
      loading: false,
      error: null,
      toggle: toggleMore,
      clear: () =>
        update(
          {},
          ["draft", "linked", "commenter", "involves", "reviewedBy", "updatedWithin", "createdAfter", "updatedAfter", "head"],
        ),
    },
  ];

  function visibleOptions(control: FilterControl): FilterOption[] {
    const text = (query[control.key] ?? "").trim().toLowerCase();
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
    setQuery((current) => ({ ...current, [control.key]: "" }));
    control.ensureLoaded?.();
  }

  return (
    <div className={styles.root} role="toolbar" aria-label={t.prFilters}>
      {controls.map((control) => {
        const options = visibleOptions(control);
        const panel = (
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>{t.prFilterBy(control.title)}</span>
              {control.multi && control.count > 0 ? (
                <span className={styles.panelCount}>{t.prSelectedCount(control.count)}</span>
              ) : null}
            </div>
            {control.searchable ? (
              <div className={styles.panelSearch}>
                <SearchOutline size={14} className={styles.searchIcon} />
                <input
                  value={query[control.key] ?? ""}
                  placeholder={t.prSearchFilter(control.label)}
                  aria-label={t.prSearchFilter(control.label)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setQuery((current) => ({ ...current, [control.key]: value }));
                  }}
                />
              </div>
            ) : null}
            <div className={styles.panelList}>
              {control.error ? (
                <p className={styles.panelError}>{control.error}</p>
              ) : control.loading && control.options.length === 0 ? (
                <div className={styles.panelLoading}>
                  <Spin size="small" />
                </div>
              ) : options.length === 0 ? (
                <p className={styles.panelEmpty}>{t.prNoFilterMatches(query[control.key] ?? "")}</p>
              ) : (
                options.map((option, index) => {
                  const section = sectionOf(index, options);
                  return (
                    <Fragment key={option.value}>
                      {section ? <p className={styles.panelSection}>{section}</p> : null}
                      <button
                        type="button"
                        className={styles.panelOption}
                        aria-pressed={control.selected.includes(option.value)}
                        onClick={() => control.toggle(option.value, !control.selected.includes(option.value))}
                      >
                        <span
                          className={`${styles.optionDot} ${option.color ? "" : styles.hidden}`}
                          style={option.color ? { background: `#${option.color}` } : undefined}
                        />
                        <span className={styles.optionLabel}>{option.label}</span>
                        {option.hint ? <span className={styles.optionHint}>{option.hint}</span> : null}
                        <CheckmarkOutline
                          size={14}
                          className={`${styles.optionCheck} ${control.selected.includes(option.value) ? styles.on : ""}`}
                        />
                      </button>
                    </Fragment>
                  );
                })
              )}
            </div>
            {control.selected.length > 0 ? (
              <div className={styles.panelFoot}>
                <button type="button" className={styles.clearBtn} onClick={() => control.clear()}>
                  {t.prClearFilter}
                </button>
              </div>
            ) : null}
          </div>
        );

        return (
          <Popover
            key={control.key}
            trigger="click"
            placement="bottomRight"
            arrow={false}
            onOpenChange={(next) => {
              if (next) onOpen(control);
            }}
            styles={FILTER_POPOVER_STYLES}
            content={panel}
          >
            <button
              type="button"
              className={`${styles.filterBtn} ${control.active !== null ? styles.active : ""}`}
              aria-label={control.active ? `${control.label}: ${control.active}` : control.label}
            >
              <span className={styles.filterLabel}>{control.label}</span>
              {control.active !== null ? (
                <span className={styles.filterValue}>
                  {control.multi && control.count > 1 ? control.count : control.active}
                </span>
              ) : null}
              <ChevronDownOutline size={12} className={styles.chev} />
            </button>
          </Popover>
        );
      })}
    </div>
  );
}

export default PullRequestFilterBar;
