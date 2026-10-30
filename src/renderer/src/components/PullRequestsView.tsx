import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dropdown } from "antd";
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
} from "@renderer/components/icons/ionicons";
import { PullRequestIcon } from "@renderer/components/icons/PullRequestIcon";
import type {
  PullRequestFilters,
  PullRequestLabel,
  PullRequestSummary,
} from "../../../shared/github-types";
import GitHubAvatar from "@renderer/components/GitHubAvatar";
import PullRequestDetailView from "@renderer/components/PullRequestDetailView";
import PullRequestFilterBar from "@renderer/components/PullRequestFilterBar";
import { usePullRequestsStore } from "@renderer/stores/pull-requests";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { formatPullRequestRelative } from "@renderer/utils/pull-request-format";
import type { Messages } from "@renderer/i18n";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import styles from "./PullRequestsView.module.css";

type PrView = "all" | "mine" | "reviewing" | "assigned" | "mentioned";
type MenuItem = { key: string; label: string };
type FilterChip = { key: keyof PullRequestFilters; label: string };

const PREFETCH_DELAY_MS = 300;

function stateIcon(row: PullRequestSummary): ReactNode {
  if (row.state === "merged") return <GitMerge size={16} />;
  if (row.state === "closed") return <CloseCircleOutline size={16} />;
  return <PullRequestIcon size={16} />;
}

function stateClass(row: PullRequestSummary): string {
  if (row.state === "merged") return "merged";
  if (row.state === "closed") return "closed";
  return row.isDraft ? "draft" : "open";
}

function checksInfo(row: PullRequestSummary, t: Messages): { text: string; tone: string } | null {
  const checks = row.checks ?? [];
  if (checks.length === 0) return null;
  if (checks.some((check) => check.state === "failure")) return { text: t.prChecksFailing, tone: "danger" };
  if (checks.some((check) => check.state === "pending")) return { text: t.prChecksRunning, tone: "warning" };
  if (checks.every((check) => check.state === "none")) return { text: t.prNoChecks, tone: "muted" };
  return { text: t.prChecksPassing, tone: "success" };
}

function reviewInfo(row: PullRequestSummary, t: Messages): { text: string; tone: string } | null {
  if (row.reviewDecision === "approved") return { text: t.prReviewApproved, tone: "success" };
  if (row.reviewDecision === "changes-requested") return { text: t.prReviewChangesRequested, tone: "danger" };
  if (row.reviewDecision === "review-required") return { text: t.prReviewRequired, tone: "warning" };
  return null;
}

function labelStyle(label: PullRequestLabel): Record<string, string> {
  return { borderColor: `#${label.color}`, color: `#${label.color}` };
}

type PrRowProps = {
  row: PullRequestSummary;
  active: boolean;
  t: Messages;
  onOpen: (row: PullRequestSummary) => void;
  onPrefetch: (row: PullRequestSummary) => void;
  onCopy: (row: PullRequestSummary) => void;
  onExternal: (row: PullRequestSummary) => void;
};

const PrRow = memo(function PrRow({ row, active, t, onOpen, onPrefetch, onCopy, onExternal }: PrRowProps): ReactNode {
  const checks = checksInfo(row, t);
  const review = reviewInfo(row, t);
  return (
    <li
      className={`${styles.prRow} ${active ? styles.highlighted : ""}`}
      onClick={() => onOpen(row)}
      onPointerEnter={() => onPrefetch(row)}
    >
      <span className={`${styles.stateIcon} ${styles[stateClass(row)]}`}>{stateIcon(row)}</span>
      <div className={styles.rowMain}>
        <div className={styles.rowTitleLine}>
          <span className={styles.rowTitle}>
            {row.title}
            <span className={styles.rowNumber}>#{row.number}</span>
          </span>
        </div>
        <div className={styles.rowSub}>
          {row.isDraft ? <span className={styles.draftTag}>{t.prDraft}</span> : null}
          {row.headBranch ? (
            <span className={styles.rowBranch}>
              <span className={styles.branchPill}>{row.headBranch}</span>
              {row.baseBranch ? <span>→</span> : null}
              {row.baseBranch ? <span className={styles.branchPill}>{row.baseBranch}</span> : null}
            </span>
          ) : null}
          {row.commentCount ? (
            <span className={styles.rowMetaItem}>
              <ChatbubbleOutline size={13} />
              {row.commentCount}
            </span>
          ) : null}
          {row.assignees?.length ? (
            <span className={styles.rowPeople}>
              {row.assignees.map((person) => (
                <GitHubAvatar key={person.login} login={person.login} src={person.avatarUrl} size="sm" />
              ))}
            </span>
          ) : null}
          <span className={styles.rowInline}>
            {checks ? <span className={`${styles.badge} ${styles[checks.tone]}`}>{checks.text}</span> : null}
            {review ? <span className={`${styles.badge} ${styles[review.tone]}`}>{review.text}</span> : null}
            {row.additions !== undefined && row.deletions !== undefined ? (
              <span className={styles.inlineDiff}>
                <span className={styles.added}>{t.prAdditionsCount(row.additions)}</span>
                <span className={styles.removed}>{t.prDeletionsCount(row.deletions)}</span>
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <div className={styles.rowAuthor}>
        {row.author ? (
          <span className={styles.authorCell}>
            <GitHubAvatar login={row.author} src={row.authorAvatarUrl} size="md" />
            <span className={styles.ellipsis}>{row.author}</span>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </div>
      <div className={styles.rowChecks}>
        {checks ? (
          <span className={`${styles.badge} ${styles[checks.tone]}`}>
            <CheckmarkCircleOutline size={12} />
            {checks.text}
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </div>
      <div className={styles.rowLabels}>
        {row.labels?.length ? (
          <span className={styles.labelChips}>
            {row.labels.map((label) => (
              <span key={label.name} className={styles.labelChip} style={labelStyle(label)}>
                {label.name}
              </span>
            ))}
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </div>
      <div className={styles.rowDiff}>
        {row.additions !== undefined && row.deletions !== undefined ? (
          <span>
            <span className={styles.added}>{t.prAdditionsCount(row.additions)}</span>
            <span className={styles.removed}>{t.prDeletionsCount(row.deletions)}</span>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </div>
      <div className={styles.rowTime}>
        <span className={styles.timeText}>{formatPullRequestRelative(row.updatedAt ?? row.createdAt)}</span>
        <span className={styles.rowActions}>
          <button
            type="button"
            className={styles.rowAction}
            title={t.prCopyLink}
            onClick={(event) => {
              event.stopPropagation();
              onCopy(row);
            }}
          >
            <CopyOutline size={13} />
          </button>
          <button
            type="button"
            className={styles.rowAction}
            title={t.prOpenOnGithub}
            onClick={(event) => {
              event.stopPropagation();
              onExternal(row);
            }}
          >
            <OpenOutline size={13} />
          </button>
        </span>
      </div>
    </li>
  );
});

export function PullRequestsView(): ReactNode {
  const t = useI18n();
  const workspace = useWorkspaceStore();
  const store = usePullRequestsStore();
  const message = useMessage();

  const [search, setSearch] = useState(store.selection.filters.text ?? "");
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);

  const listEl = useRef<HTMLDivElement | null>(null);
  const listScrollTop = useRef(0);
  const prefetchTimer = useRef(0);
  const detailPrefetch = useRef(new Map<string, number>());

  const list = store.list;
  const rows = list.pullRequests;
  const hasWorkspace = Boolean(workspace.root);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const openUrlRef = useRef(openUrl);
  openUrlRef.current = openUrl;
  const highlightedRef = useRef(highlighted);
  highlightedRef.current = highlighted;

  const view: PrView = (() => {
    const filters = store.selection.filters;
    if (filters.reviewRequested === "@me") return "reviewing";
    if (filters.assignee === "@me") return "assigned";
    if (filters.mentions === "@me") return "mentioned";
    return store.selection.author === "mine" ? "mine" : "all";
  })();

  const viewItems: MenuItem[] = [
    { key: "all", label: t.prViewAll },
    { key: "mine", label: t.prViewMine },
    { key: "reviewing", label: t.prViewReviewing },
    { key: "assigned", label: t.prViewAssigned },
    { key: "mentioned", label: t.prViewMentioned },
  ];

  const viewLabel = viewItems.find((item) => item.key === view)?.label ?? "";

  const stateTabs = [
    { key: "open" as const, label: t.prStateOpen, count: list.counts?.open },
    { key: "closed" as const, label: t.prStateClosed, count: list.counts?.closed },
    { key: "merged" as const, label: t.prStateMerged, count: list.counts?.merged },
    { key: "all" as const, label: t.prStateAll, count: undefined },
  ];

  const sortItems: MenuItem[] = [
    { key: "updated-desc", label: t.prSortUpdatedDesc },
    { key: "updated-asc", label: t.prSortUpdatedAsc },
    { key: "created-desc", label: t.prSortCreatedDesc },
    { key: "created-asc", label: t.prSortCreatedAsc },
    { key: "comments-desc", label: t.prSortCommentsDesc },
    { key: "comments-asc", label: t.prSortCommentsAsc },
    { key: "reactions-desc", label: t.prSortReactionsDesc },
    { key: "interactions-desc", label: t.prSortInteractionsDesc },
  ];

  const sortLabel =
    sortItems.find((item) => item.key === (store.selection.filters.sort ?? "updated-desc"))?.label ?? "";

  const chips: FilterChip[] = (() => {
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
  })();

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

  function selectState(state: (typeof stateTabs)[number]["key"]): void {
    store.setSelection({ state });
  }

  function submitSearch(): void {
    store.setFilter("text", search.trim() || undefined);
  }

  function removeChip(chip: FilterChip): void {
    store.setFilter(chip.key, undefined);
  }

  function onRefresh(): void {
    if (!hasWorkspace) {
      message.warning(t.prOpenProject);
      return;
    }
    store.refresh();
  }

  const openDetail = useCallback((row: PullRequestSummary): void => {
    listScrollTop.current = listEl.current?.scrollTop ?? listScrollTop.current;
    setOpenUrl(row.url);
    setHighlighted(-1);
  }, []);

  function closeDetail(): void {
    setOpenUrl(null);
    void new Promise<void>((resolve) => requestAnimationFrame(() => resolve())).then(() => {
      if (listEl.current) listEl.current.scrollTop = listScrollTop.current;
    });
  }

  const prefetch = useCallback((row: PullRequestSummary): void => {
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => {
      const at = detailPrefetch.current.get(row.url);
      if (at && Date.now() - at < 60_000) return;
      detailPrefetch.current.set(row.url, Date.now());
      void window.api.github.pullRequestDetail({ url: row.url });
    }, PREFETCH_DELAY_MS);
  }, []);

  const copyLink = useCallback(
    (row: PullRequestSummary): void => {
      void navigator.clipboard.writeText(row.url).then(
        () => message.success(t.prCopiedLink),
        () => message.error(t.prCouldNotLoadFiles),
      );
    },
    [message, t],
  );

  const openOnGithub = useCallback((row: PullRequestSummary): void => {
    void window.api.browser.openExternal(row.url);
  }, []);

  function moveHighlight(step: number): void {
    if (rowsRef.current.length === 0) return;
    setHighlighted((current) => {
      const count = rowsRef.current.length;
      const next = current < 0 ? (step > 0 ? 0 : count - 1) : current + step;
      return Math.max(0, Math.min(count - 1, next));
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (openUrlRef.current) return;
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
      const row = rowsRef.current[highlightedRef.current];
      if (!row) return;
      event.preventDefault();
      openDetail(row);
    }
  }

  useEffect(() => {
    if (hasWorkspace) void store.load();
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.clearTimeout(prefetchTimer.current);
      window.removeEventListener("keydown", onKeydown);
    };
  }, []);

  return (
    <section className={styles.root}>
      {openUrl ? (
        <PullRequestDetailView url={openUrl} onBack={closeDetail} />
      ) : (
        <>
          <header className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t.pullRequests}</h1>
            {list.repository ? <span className={styles.repoName}>{list.repository}</span> : null}
            <div className={styles.headTools}>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: viewItems,
                  onClick: ({ key }) => selectView(key as PrView),
                }}
              >
                <button type="button" className={styles.viewBtn} aria-label={t.prShowView(viewLabel)}>
                  <span>{viewLabel}</span>
                  <ChevronDownOutline size={14} className={styles.chev} />
                </button>
              </Dropdown>
              <form
                className={styles.searchBox}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSearch();
                }}
              >
                <SearchOutline size={14} className={styles.searchIcon} />
                <input
                  value={search}
                  className={styles.searchInput}
                  type="search"
                  placeholder={t.prSearchPlaceholder}
                  onChange={(event) => setSearch(event.target.value)}
                  onBlur={submitSearch}
                />
              </form>
              <button
                type="button"
                className={styles.iconBtn}
                disabled={list.loading}
                title={t.prRefresh}
                onClick={onRefresh}
              >
                <RefreshOutline size={15} className={list.loading ? styles.spinning : undefined} />
              </button>
            </div>
          </header>

          <div className={styles.tabsRow}>
            <div className={styles.stateTabs} role="tablist" aria-label={t.prFilterState}>
              {stateTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  className={`${styles.stateTab} ${store.selection.state === tab.key ? styles.active : ""}`}
                  aria-selected={store.selection.state === tab.key}
                  onClick={() => selectState(tab.key)}
                >
                  {tab.label}
                  {tab.count !== undefined ? <span className={styles.count}>{tab.count}</span> : null}
                </button>
              ))}
            </div>
            <div className={styles.tabsTools}>
              <PullRequestFilterBar />
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: sortItems,
                  onClick: ({ key }) => setFilter("sort", key),
                }}
              >
                <button type="button" className={styles.sortBtn} aria-label={t.prSortBy(sortLabel)}>
                  <span>{sortLabel}</span>
                  <ChevronDownOutline size={12} />
                </button>
              </Dropdown>
            </div>
          </div>

          {chips.length ? (
            <div className={styles.chips}>
              {chips.map((chip) => (
                <button
                  key={`${String(chip.key)}-${chip.label}`}
                  type="button"
                  className={styles.chip}
                  onClick={() => removeChip(chip)}
                >
                  {chip.label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
              <button type="button" className={`${styles.chip} ${styles.clear}`} onClick={() => store.clearFilters()}>
                {t.prClearFilters}
              </button>
            </div>
          ) : null}

          <div ref={listEl} className={styles.list}>
            {!hasWorkspace ? (
              <div className={styles.empty}>
                <div className={styles.emptyTitle}>{t.prOpenProject}</div>
                <div className={styles.emptyHint}>{t.prNoPullRequestsHint}</div>
              </div>
            ) : list.error && rows.length === 0 ? (
              <div className={styles.alert}>
                <p>{list.error}</p>
                <button type="button" className={styles.linkBtn} onClick={onRefresh}>
                  {t.prRefresh}
                </button>
              </div>
            ) : (
              <>
                {list.error ? (
                  <div className={`${styles.alert} ${styles.compact}`}>
                    <span className={styles.ellipsis}>{list.error}</span>
                    <span className={styles.muted}>{t.prShowingLastLoaded}</span>
                  </div>
                ) : null}
                {list.loading && rows.length === 0 ? (
                  <div className={styles.skeleton}>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <div key={index} className={styles.skeletonRow}>
                        <span className={styles.skeletonDot} />
                        <span className={styles.skeletonLine} />
                        <span className={`${styles.skeletonLine} ${styles.short}`} />
                      </div>
                    ))}
                  </div>
                ) : rows.length === 0 ? (
                  <div className={styles.empty}>
                    <div className={styles.emptyTitle}>{t.prNoPullRequests}</div>
                    <div className={styles.emptyHint}>
                      {chips.length ? t.prNoMatchesHintFilters : t.prNoPullRequestsHint}
                    </div>
                    {chips.length ? (
                      <button type="button" className={styles.linkBtn} onClick={() => store.clearFilters()}>
                        {t.prClearFilters}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className={styles.listSummary}>
                      {list.totalCount ? <span>{t.prTotal(list.totalCount)}</span> : null}
                      <span className={styles.spacer} />
                      {list.nextCursor ? <span>{t.prShowingCount(rows.length, list.totalCount)}</span> : null}
                    </div>
                    <ul className={styles.prList} aria-label={t.pullRequests}>
                      {rows.map((row, index) => (
                        <PrRow
                          key={row.url}
                          row={row}
                          active={index === highlighted}
                          t={t}
                          onOpen={openDetail}
                          onPrefetch={prefetch}
                          onCopy={copyLink}
                          onExternal={openOnGithub}
                        />
                      ))}
                    </ul>
                    <div className={styles.listFoot}>
                      {list.moreError ? <p className={styles.moreError}>{list.moreError}</p> : null}
                      {list.nextCursor ? (
                        <button
                          type="button"
                          className={styles.loadMore}
                          disabled={list.loadingMore}
                          onClick={() => void store.loadMore()}
                        >
                          {t.prLoadMore}
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default PullRequestsView;
