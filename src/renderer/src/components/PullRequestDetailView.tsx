import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button, Dropdown, Input, Spin } from "antd";
import type { MenuProps } from "antd";
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
} from "@renderer/components/icons/ionicons";
import { PullRequestIcon } from "@renderer/components/icons/PullRequestIcon";
import type {
  PullRequestAction,
  PullRequestCheck,
  PullRequestChoices,
  PullRequestDetail,
  PullRequestLabel,
  PullRequestMergeMethod,
  PullRequestReviewState,
} from "../../../shared/github-types";
import GitHubAvatar from "@renderer/components/GitHubAvatar";
import PullRequestChoicePopover, { type ChoiceOption } from "@renderer/components/PullRequestChoicePopover";
import PullRequestConversation from "@renderer/components/PullRequestConversation";
import PullRequestFiles from "@renderer/components/PullRequestFiles";
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
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import { plainIpcArgs } from "@renderer/utils/ipc-plain";
import styles from "./PullRequestDetailView.module.css";

type Props = {
  url: string;
  onBack?: () => void;
};

export type PullRequestDetailViewHandle = {
  refresh: () => Promise<void>;
};

type DetailSection = "conversation" | "commits" | "checks" | "files";
type MenuItem = NonNullable<MenuProps["items"]>[number];

const DETAIL_TTL_MS = 30_000;
const DETAIL_CACHE_LIMIT = 20;

/** 跨挂载共享的详情缓存，关掉再打开同一个 PR 直接命中。 */
const detailCache = new Map<string, { detail: PullRequestDetail; at: number }>();

function rememberDetail(key: string, detail: PullRequestDetail): void {
	detailCache.delete(key);
	detailCache.set(key, { detail, at: Date.now() });
	while (detailCache.size > DETAIL_CACHE_LIMIT) {
		const oldest = detailCache.keys().next();
		if (oldest.done) break;
		detailCache.delete(oldest.value);
	}
}

export const PullRequestDetailView = forwardRef<PullRequestDetailViewHandle, Props>(
  function PullRequestDetailView({ url, onBack }, ref) {
    const t = useI18n();
    const message = useMessage();

    const [detail, setDetailState] = useState<PullRequestDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [section, setSectionState] = useState<DetailSection>("conversation");
    const [pending, setPending] = useState<Set<string>>(new Set());
    const [patch, setPatchState] = useState("");
    const [patchLoading, setPatchLoading] = useState(false);
    const [patchError, setPatchError] = useState<string | null>(null);
    const [, setStaleNotice] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reviewEvent, setReviewEvent] = useState<"approve" | "request-changes" | "comment">("comment");
    const [reviewBody, setReviewBody] = useState("");
    const [choices, setChoices] = useState<PullRequestChoices>({});
    const [choicesLoading, setChoicesLoading] = useState(false);
    const [choicesError, setChoicesError] = useState<string | null>(null);

    const detailRef = useRef<PullRequestDetail | null>(null);
    const patchRef = useRef("");
    const patchHeadRef = useRef<string | null>(null);
    const sectionRef = useRef<DetailSection>("conversation");
    const onBackRef = useRef(onBack);
    onBackRef.current = onBack;

    function setDetail(next: PullRequestDetail | null): void {
      detailRef.current = next;
      setDetailState(next);
    }

    function setPatch(next: string): void {
      patchRef.current = next;
      setPatchState(next);
    }

    function setPatchHead(next: string | null): void {
      patchHeadRef.current = next;
    }

    function setSection(next: DetailSection): void {
      sectionRef.current = next;
      setSectionState(next);
    }

    const pullRequest = detail?.pullRequest ?? null;
    const checks = pullRequest?.checks ?? [];
    const summary = checksSummary(checks);
    const canWrite = hasWritePermission(detail?.viewerPermission ?? "none");
    const canEditMeta = canTriage(detail?.viewerPermission ?? "none");
    const mergeReady = detail && pullRequest ? canMerge(pullRequest, detail.mergeState) : false;
    const mergeMethods: PullRequestMergeMethod[] = detail?.mergeMethods.length
      ? detail.mergeMethods
      : ["squash", "merge", "rebase"];

    const sections: { key: DetailSection; label: string; count?: number }[] = [
      { key: "conversation", label: t.prConversation, count: detail?.comments.length },
      { key: "commits", label: t.prCommitsTab, count: detail?.commits.length },
      { key: "checks", label: t.prChecksTab, count: summary.total || undefined },
      {
        key: "files",
        label: t.prFilesTab,
        count: pullRequest?.changedFiles ?? detail?.files.length,
      },
    ];

    const participants = (() => {
      const target = detail;
      if (!target) return [];
      const people = new Set<string>();
      if (target.pullRequest.author) people.add(target.pullRequest.author);
      for (const comment of target.comments) people.add(comment.author);
      for (const review of target.reviews) people.add(review.author);
      for (const login of target.assignees) people.add(login);
      return [...people].filter(Boolean);
    })();

    const banner = ((): { tone: string; text: string } => {
      const pr = pullRequest;
      const state = detail?.mergeState ?? "unknown";
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
        checks.some((check) => check.state === "pending") &&
        !checks.some((check) => check.state === "failure")
      ) {
        return { tone: "warning", text: t.prChecksRunningBanner };
      }
      const tone =
        state === "clean" ? "success" : state === "conflicts" ? "danger" : state === "unknown" ? "muted" : "warning";
      return { tone, text: mergeStateLabel(state) };
    })();

    function actionKey(action: PullRequestAction): string {
      if (action.kind === "reply") return `reply:${action.commentId}`;
      if (action.kind === "resolve-thread") return `resolve-thread:${action.threadId}`;
      if (action.kind === "line-comment") return `line-comment:${action.path}`;
      if (action.kind === "rerun-checks") return `rerun-checks:${action.urls.join(" ")}`;
      if (action.kind === "edit-comment") return `edit-comment:${action.commentId}`;
      return action.kind;
    }

    async function loadDetail(force = false): Promise<void> {
      const target = url;
      const cached = detailCache.get(target);
      if (!force && cached && Date.now() - cached.at < DETAIL_TTL_MS) {
        setDetail(cached.detail);
        return;
      }
      setLoading(detailRef.current === null);
      setError(null);
      try {
        const response = await window.api.github.pullRequestDetail(
          plainIpcArgs({ url: target, ...(force ? { fresh: true } : {}) }),
        );
        if (!response.success) {
          setError(response.error || t.prCouldNotLoad);
          return;
        }
        const next = response.detail;
        if (patchHeadRef.current !== null && patchHeadRef.current !== next.headSha) {
          setPatchHead(null);
          setPatch("");
          setPatchError(t.prStaleNotice);
        }
        rememberDetail(target, next);
        setDetail(next);
        if (next.stale) void loadDetail(true);
      } catch {
        setError(t.prCouldNotLoad);
      } finally {
        setLoading(false);
      }
    }

    async function loadPatch(force = false): Promise<void> {
      if (!detailRef.current || (patchRef.current && !force)) return;
      setPatchLoading(true);
      setPatchError(null);
      try {
        const head = detailRef.current.headSha;
        const response = await window.api.github.pullRequestPatch(
          plainIpcArgs({
            url,
            ...(/^[0-9a-f]{40}$/.test(head) ? { headSha: head } : {}),
          }),
        );
        if (!response.success) {
          setPatchError(response.error || t.prCouldNotLoadFiles);
          return;
        }
        if (response.stale) {
          setStaleNotice(true);
          setPatchHead(null);
          setPatch("");
          await loadDetail(true);
          return;
        }
        setPatch(response.patch);
        setPatchHead(response.headSha || head || null);
      } catch {
        setPatchError(t.prCouldNotLoadFiles);
      } finally {
        setPatchLoading(false);
      }
    }

    async function run(action: PullRequestAction): Promise<boolean> {
      const key = actionKey(action);
      setPending((current) => new Set(current).add(key));
      try {
        const response = await window.api.github.pullRequestAction(plainIpcArgs({ url, action }));
        if (!response.success) {
          message.error(response.error || t.prCouldNotUpdate);
          return false;
        }
        await loadDetail(true);
        if (patchRef.current && sectionRef.current === "files") await loadPatch(true);
        return true;
      } catch {
        message.error(t.prCouldNotUpdate);
        return false;
      } finally {
        setPending((current) => {
          const settled = new Set(current);
          settled.delete(key);
          return settled;
        });
      }
    }

    function selectSection(next: DetailSection): void {
      setSection(next);
      if (next === "files") void loadPatch();
    }

    function openExternal(): void {
      if (pullRequest) void window.api.browser.openExternal(pullRequest.url);
    }

    function beginTitleEdit(): void {
      if (!detail?.viewerCanUpdate || !pullRequest) return;
      setTitleDraft(pullRequest.title);
      setEditingTitle(true);
    }

    async function submitTitle(): Promise<void> {
      const title = titleDraft.trim();
      const current = pullRequest?.title ?? "";
      if (!title || title === current) {
        setEditingTitle(false);
        return;
      }
      if (await run({ kind: "edit-title", title })) setEditingTitle(false);
    }

    function mergeOptions(): MenuItem[] {
      return mergeMethods.map((method) => ({
        label:
          method === "squash" ? t.prSquashAndMerge : method === "merge" ? t.prCreateMergeCommit : t.prRebaseAndMerge,
        key: method,
      }));
    }

    async function onMergeSelect(method: PullRequestMergeMethod): Promise<void> {
      const head = detail?.headSha ?? "";
      if (!/^[0-9a-f]{40}$/.test(head)) {
        message.error(t.prCouldNotUpdate);
        return;
      }
      await run({ kind: "merge", method, headSha: head });
    }

    function beginReview(event: "approve" | "request-changes" | "comment"): void {
      setReviewEvent(event);
      setReviewBody("");
      setReviewOpen(true);
    }

    async function submitReview(): Promise<void> {
      const body = reviewBody;
      if (reviewEvent !== "approve" && !body.trim()) {
        message.warning(t.prReviewCommentRequired);
        return;
      }
      if (await run({ kind: "review", event: reviewEvent, body })) setReviewOpen(false);
    }

    async function setState(state: "close" | "reopen" | "ready" | "draft"): Promise<void> {
      await run({ kind: "state", state });
    }

    async function loadChoices(kind: "labels" | "people" | "milestones"): Promise<void> {
      const loaded =
        kind === "labels" ? choices.labels : kind === "people" ? choices.people : choices.milestones;
      if (loaded) return;
      setChoicesLoading(true);
      setChoicesError(null);
      try {
        const response = await window.api.github.pullRequestChoices(plainIpcArgs({ url, kind }));
        if (!response.success) {
          setChoicesError(response.error || t.prCouldNotLoadChoices);
          return;
        }
        setChoices((current) => ({
          ...current,
          labels: response.labels ?? current.labels,
          people: response.people ?? current.people,
          milestones: response.milestones ?? current.milestones,
        }));
      } finally {
        setChoicesLoading(false);
      }
    }

    function labelChoiceOptions(): ChoiceOption[] {
      return (choices.labels ?? []).map((label) => ({ value: label.name, color: label.color }));
    }

    function peopleChoiceOptions(): ChoiceOption[] {
      return (choices.people ?? []).map((login) => ({ value: login }));
    }

    function milestoneChoiceOptions(): ChoiceOption[] {
      return (choices.milestones ?? []).map((milestone) => ({ value: milestone.title }));
    }

    function toggleName(kind: "labels" | "assignees" | "reviewers", value: string, on: boolean): void {
      const current = currentNames(kind);
      const next = on ? [...current, value] : current.filter((name) => name !== value);
      void applyNames(kind, next);
    }

    function currentNames(kind: "labels" | "assignees" | "reviewers"): string[] {
      const target = detail;
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
      const urls = checks.map((check) => check.url ?? "").filter((url) => url.includes("/actions/runs/"));
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
      if (document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], .ant-popover')) return;
      onBackRef.current?.();
    }

    useEffect(() => {
      setDetail(null);
      setPatch("");
      setPatchHead(null);
      setPatchError(null);
      setStaleNotice(false);
      setSection("conversation");
      void loadDetail();
    }, [url]);

    useEffect(() => {
      window.addEventListener("keydown", onEscape);
      return () => window.removeEventListener("keydown", onEscape);
    }, []);

    useImperativeHandle(ref, () => ({ refresh: () => loadDetail(true) }));

    const stateIconTone =
      pullRequest?.state === "merged"
        ? "merged"
        : pullRequest?.state === "closed"
          ? "closed"
          : pullRequest?.isDraft
            ? "draft"
            : "open";

    return (
      <div className={styles.root}>
        <header className={styles.detailHead}>
          <div className={styles.headRow}>
            <button type="button" className={styles.backBtn} onClick={() => onBack?.()}>
              <ArrowBackOutline size={14} />
              <span>{t.pullRequests}</span>
            </button>
            <span className={styles.spacer} />
            <button type="button" className={styles.ghostBtn} disabled={loading} onClick={() => void loadDetail(true)}>
              <RefreshOutline size={14} className={loading ? styles.spinning : undefined} />
            </button>
            {pullRequest ? (
              <button type="button" className={styles.ghostBtn} onClick={openExternal}>
                <OpenOutline size={14} />
                <span>GitHub</span>
              </button>
            ) : null}
            {canWrite && pullRequest?.state === "open" ? (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { label: t.prApprove, key: "approve" },
                    { label: t.prRequestChanges, key: "request-changes" },
                    { label: t.prComment, key: "comment" },
                  ],
                  onClick: ({ key }) => beginReview(key as "approve" | "request-changes" | "comment"),
                }}
              >
                <Button size="small" type="primary">
                  <span className={styles.reviewBtn}>
                    {t.prSubmitReview}
                    <ChevronDownOutline size={12} />
                  </span>
                </Button>
              </Dropdown>
            ) : null}
          </div>

          {loading && !detail ? (
            <div className={styles.skeletonTitle}>
              <Spin size="small" />
            </div>
          ) : null}

          {pullRequest && !(loading && !detail) ? (
            <>
              <div className={styles.titleRow}>
                <span className={`${styles.stateIcon} ${styles[stateIconTone]}`}>
                  {pullRequest.state === "merged" ? (
                    <GitMerge size={20} />
                  ) : pullRequest.state === "closed" ? (
                    <CloseCircleOutline size={20} />
                  ) : (
                    <PullRequestIcon size={20} />
                  )}
                </span>
                {!editingTitle ? (
                  <h1 className={styles.title}>
                    {pullRequest.title}
                    <span className={styles.number}>
                      #{pullRequest.number}
                      {detail?.viewerCanUpdate ? (
                        <button
                          type="button"
                          className={styles.editTitle}
                          title={t.prEditTitle}
                          onClick={beginTitleEdit}
                        >
                          <PencilOutline size={13} />
                        </button>
                      ) : null}
                    </span>
                  </h1>
                ) : (
                  <div className={styles.titleEditor}>
                    <input
                      value={titleDraft}
                      className={styles.titleInput}
                      maxLength={256}
                      aria-label={t.prEditTitle}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submitTitle();
                        }
                        if (event.key === "Escape") setEditingTitle(false);
                      }}
                    />
                    <Button size="small" type="primary" loading={pending.has("edit-title")} onClick={() => void submitTitle()}>
                      {t.prSave}
                    </Button>
                    <Button size="small" type="text" onClick={() => setEditingTitle(false)}>
                      {t.cancel}
                    </Button>
                  </div>
                )}
                <span className={`${styles.stateBadge} ${styles[banner.tone]}`}>
                  {pullRequestStateLabel(pullRequest)}
                </span>
              </div>

              <div className={styles.metaRow}>
                {pullRequest.author ? (
                  <span className={styles.metaItem}>
                    <GitHubAvatar login={pullRequest.author} avatars={detail?.avatars} size="md" />
                    {pullRequest.author}
                  </span>
                ) : null}
                {pullRequest.headBranch ? (
                  <span className={`${styles.metaItem} ${styles.branch}`}>
                    <span className={styles.branchPill}>{pullRequest.headBranch}</span>
                    {pullRequest.baseBranch ? <span className={styles.arrow}>→</span> : null}
                    {pullRequest.baseBranch ? <span className={styles.branchPill}>{pullRequest.baseBranch}</span> : null}
                  </span>
                ) : null}
                <span className={styles.spacer} />
                {pullRequest.additions !== undefined && pullRequest.deletions !== undefined ? (
                  <span className={`${styles.metaItem} ${styles.diffStat}`}>
                    <span className={styles.added}>{t.prAdditionsCount(pullRequest.additions)}</span>
                    <span className={styles.removed}>{t.prDeletionsCount(pullRequest.deletions)}</span>
                    {pullRequest.changedFiles !== undefined ? (
                      <span className={styles.files}>{t.prFileCount(pullRequest.changedFiles)}</span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </header>

        {error && !detail ? (
          <div className={`${styles.alert} ${styles.error}`}>
            <span>{error}</span>
            <button type="button" className={styles.linkBtn} onClick={() => void loadDetail(true)}>
              {t.prRefresh}
            </button>
          </div>
        ) : null}
        {error && detail ? (
          <div className={`${styles.alert} ${styles.error} ${styles.compact}`}>
            <span className={styles.ellipsis}>{error}</span>
            <button type="button" className={styles.linkBtn} onClick={() => void loadDetail(true)}>
              {t.prRefresh}
            </button>
          </div>
        ) : null}
        {detail?.enrichmentFailed && !loading ? (
          <div className={`${styles.alert} ${styles.warning}`}>
            <span>{t.prEnrichmentFailed}</span>
            <button type="button" className={styles.linkBtn} onClick={() => void loadDetail(true)}>
              {t.prRefresh}
            </button>
          </div>
        ) : null}

        {detail ? (
          <nav className={styles.sections}>
            {sections.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`${styles.sectionTab} ${section === item.key ? styles.active : ""}`}
                onClick={() => selectSection(item.key)}
              >
                {item.label}
                {item.count ? <span className={styles.count}>{item.count}</span> : null}
              </button>
            ))}
          </nav>
        ) : null}

        {reviewOpen ? (
          <div className={styles.reviewPanel}>
            <div className={styles.reviewHead}>
              {reviewEvent === "approve" ? t.prApprove : reviewEvent === "request-changes" ? t.prRequestChanges : t.prComment}
            </div>
            <Input.TextArea
              value={reviewBody}
              onChange={(event) => setReviewBody(event.target.value)}
              placeholder={reviewEvent === "approve" ? t.prReviewBodyPlaceholder : t.prReviewCommentRequired}
              autoSize={{ minRows: 3, maxRows: 12 }}
            />
            <div className={styles.reviewActions}>
              <Button size="small" type="text" onClick={() => setReviewOpen(false)}>
                {t.cancel}
              </Button>
              <Button size="small" type="primary" loading={pending.has("review")} onClick={() => void submitReview()}>
                {t.prSubmitReview}
              </Button>
            </div>
          </div>
        ) : null}

        {detail ? (
          <div className={styles.detailGrid}>
            <div className={styles.detailMain}>
              {section === "conversation" ? (
                <PullRequestConversation detail={detail} pending={pending} onRun={(action) => void run(action)} />
              ) : null}
              {section === "commits" ? (
                <div className={styles.commits}>
                  {detail.commits.map((commit) => (
                    <div key={commit.oid} className={styles.commit}>
                      <GitCommitOutline size={14} className={styles.commitIcon} />
                      <div className={styles.commitMain}>
                        <div className={styles.commitHeadline}>{commit.headline}</div>
                        <div className={styles.commitMeta}>
                          <span className={styles.oid}>{commit.oid.slice(0, 7)}</span>
                          <span>{commit.author}</span>
                          <span>{formatPullRequestDate(commit.authoredAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {detail.commits.length === 0 ? <div className={styles.empty}>{t.prNoMatches}</div> : null}
                </div>
              ) : null}
              {section === "checks" ? (
                <div className={styles.checks}>
                  <div className={styles.checksActions}>
                    <Button size="small" type="text" disabled={summary.failed === 0} onClick={() => rerunChecks(true)}>
                      {t.prRerunFailed}
                    </Button>
                    <Button size="small" type="text" disabled={summary.total === 0} onClick={() => rerunChecks(false)}>
                      {t.prRerunAll}
                    </Button>
                  </div>
                  <ul className={styles.checkList}>
                    {checks.map((check) => (
                      <li key={`${check.name}-${check.url ?? ""}`} className={styles.check}>
                        <span className={`${styles.dot} ${styles[checkStateClass(check)]}`} />
                        <span className={styles.checkName}>{check.name}</span>
                        <span className={`${styles.checkState} ${styles[checkStateClass(check)]}`}>
                          {check.state === "success"
                            ? t.prChecksPassing
                            : check.state === "failure"
                              ? t.prChecksFailing
                              : check.state === "pending"
                                ? t.prChecksRunning
                                : t.prNoChecks}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {checks.length === 0 ? <div className={styles.empty}>{t.prNoChecks}</div> : null}
                  {detail.reviews.length ? (
                    <div className={styles.reviews}>
                      <div className={styles.reviewsTitle}>{t.prReviewers}</div>
                      {detail.reviews.map((review) => (
                        <div key={review.id} className={styles.reviewRow}>
                          <span className={styles.reviewAuthor}>{review.author}</span>
                          <span className={`${styles.badge} ${styles[reviewStateClass(review.state)]}`}>
                            {reviewStateLabel(review.state)}
                          </span>
                          <span className={styles.muted}>{formatPullRequestRelative(review.submittedAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {section === "files" ? (
                <PullRequestFiles
                  patch={patch}
                  loading={patchLoading}
                  error={patchError}
                  detail={detail}
                  pending={pending}
                  onRun={(action) => void run(action)}
                  onReload={() => void loadPatch(true)}
                />
              ) : null}
            </div>

            <aside className={styles.detailSide}>
              <section className={styles.sideBlock}>
                <header className={styles.sideHead}>
                  <PeopleOutline size={14} className={styles.sideIcon} />
                  <span>{t.prReviewers}</span>
                  {canEditMeta ? (
                    <PullRequestChoicePopover
                      title={t.prReviewers}
                      options={peopleChoiceOptions()}
                      selected={detail.reviewRequests}
                      loading={choicesLoading}
                      error={choicesError}
                      multi
                      onLoad={() => void loadChoices("people")}
                      onToggle={(value, on) => toggleName("reviewers", value, on)}
                    />
                  ) : null}
                </header>
                {detail.reviewRequests.length ? (
                  <ul className={styles.sideList}>
                    {detail.reviewRequests.map((login) => (
                      <li key={login} className={styles.sideRow}>
                        <GitHubAvatar login={login} avatars={detail.avatars} size="sm" />
                        <span className={styles.ellipsis}>{login}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.sideEmpty}>{t.prNoReviewers}</p>
                )}
              </section>

              <section className={styles.sideBlock}>
                <header className={styles.sideHead}>
                  <PersonAddOutline size={14} className={styles.sideIcon} />
                  <span>{t.prAssignees}</span>
                  {canEditMeta ? (
                    <PullRequestChoicePopover
                      title={t.prAssignees}
                      options={peopleChoiceOptions()}
                      selected={detail.assignees}
                      loading={choicesLoading}
                      error={choicesError}
                      multi
                      onLoad={() => void loadChoices("people")}
                      onToggle={(value, on) => toggleName("assignees", value, on)}
                    />
                  ) : null}
                </header>
                {detail.assignees.length ? (
                  <ul className={styles.sideList}>
                    {detail.assignees.map((login) => (
                      <li key={login} className={styles.sideRow}>
                        <GitHubAvatar login={login} avatars={detail.avatars} size="sm" />
                        <span className={styles.ellipsis}>{login}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.sideEmpty}>{t.prNoAssignees}</p>
                )}
              </section>

              <section className={styles.sideBlock}>
                <header className={styles.sideHead}>
                  <PricetagOutline size={14} className={styles.sideIcon} />
                  <span>{t.prLabels}</span>
                  {canEditMeta ? (
                    <PullRequestChoicePopover
                      title={t.prLabels}
                      options={labelChoiceOptions()}
                      selected={detail.labels.map((label) => label.name)}
                      loading={choicesLoading}
                      error={choicesError}
                      multi
                      onLoad={() => void loadChoices("labels")}
                      onToggle={(value, on) => toggleName("labels", value, on)}
                    />
                  ) : null}
                </header>
                {detail.labels.length ? (
                  <div className={styles.labelChips}>
                    {detail.labels.map((label) => (
                      <span key={label.name} className={styles.labelChip} style={labelStyle(label)}>
                        {label.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className={styles.sideEmpty}>{t.prNoLabels}</p>
                )}
              </section>

              <section className={styles.sideBlock}>
                <header className={styles.sideHead}>
                  <FlagOutline size={14} className={styles.sideIcon} />
                  <span>{t.prMilestone}</span>
                  {canEditMeta ? (
                    <PullRequestChoicePopover
                      title={t.prMilestone}
                      options={milestoneChoiceOptions()}
                      selected={detail.milestone ? [detail.milestone.title] : []}
                      loading={choicesLoading}
                      error={choicesError}
                      onLoad={() => void loadChoices("milestones")}
                      onToggle={(value, on) => void applyMilestone(on ? value : null)}
                    />
                  ) : null}
                </header>
                {detail.milestone ? (
                  <p className={styles.sideText}>{detail.milestone.title}</p>
                ) : (
                  <p className={styles.sideEmpty}>{t.prNoMilestone}</p>
                )}
              </section>

              {detail.linkedIssues.length ? (
                <section className={styles.sideBlock}>
                  <header className={styles.sideHead}>
                    <LinkOutline size={14} className={styles.sideIcon} />
                    <span>{t.prLinkedIssues}</span>
                  </header>
                  <ul className={styles.sideList}>
                    {detail.linkedIssues.map((issue) => (
                      <li key={issue.url} className={styles.sideRow}>
                        <span
                          className={`${styles.issueState} ${issue.state === "open" ? styles.open : ""}`}
                        />
                        <span className={styles.ellipsis}>
                          #{issue.number} {issue.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {participants.length ? (
                <section className={styles.sideBlock}>
                  <header className={styles.sideHead}>
                    <PersonOutline size={14} className={styles.sideIcon} />
                    <span>{t.prReviewers}</span>
                  </header>
                  <div className={styles.participants}>
                    {participants.map((login) => (
                      <GitHubAvatar key={login} login={login} avatars={detail.avatars} size="lg" />
                    ))}
                  </div>
                </section>
              ) : null}

              <section className={styles.sideBlock}>
                <header className={styles.sideHead}>
                  <GitMerge size={14} className={styles.sideIcon} />
                  <span>{t.prMerge}</span>
                  <span className={`${styles.dot} ${styles[banner.tone]}`} />
                </header>
                <p className={`${styles.sideText} ${styles[banner.tone]}`}>{banner.text}</p>
                <p className={styles.sideMuted}>
                  {summary.total ? t.prChecksPassed(summary.passed, summary.total) : t.prNoChecks}
                </p>
                <div className={styles.mergeActions}>
                  {canWrite && pullRequest?.state === "open" ? (
                    <Dropdown
                      trigger={["click"]}
                      disabled={!mergeReady}
                      menu={{
                        items: mergeOptions(),
                        onClick: ({ key }) => void onMergeSelect(key as PullRequestMergeMethod),
                      }}
                    >
                      <Button
                        size="small"
                        type="primary"
                        disabled={!mergeReady || pending.has("merge")}
                      >
                        <GitMerge size={13} />
                        {t.prMerge}
                      </Button>
                    </Dropdown>
                  ) : null}
                  {canWrite && pullRequest?.state === "open" ? (
                    <Button
                      size="small"
                      type="text"
                      disabled={pending.has("update-branch")}
                      onClick={() => void run({ kind: "update-branch", rebase: false })}
                    >
                      {t.prRefresh}
                    </Button>
                  ) : null}
                  {canWrite && pullRequest?.state === "open" ? (
                    <Button size="small" type="text" onClick={() => void setState("close")}>
                      {t.prClosePullRequest}
                    </Button>
                  ) : null}
                  {canWrite && pullRequest?.state !== "open" ? (
                    <Button size="small" type="text" onClick={() => void setState("reopen")}>
                      {t.prReopenPullRequest}
                    </Button>
                  ) : null}
                  {canWrite && pullRequest?.state === "open" ? (
                    <Button
                      size="small"
                      type="text"
                      onClick={() => void setState(pullRequest.isDraft ? "ready" : "draft")}
                    >
                      {pullRequest.isDraft ? t.prReadyForReview : t.prConvertToDraft}
                    </Button>
                  ) : null}
                </div>
              </section>
            </aside>
          </div>
        ) : null}
      </div>
    );
  },
);

export default PullRequestDetailView;
