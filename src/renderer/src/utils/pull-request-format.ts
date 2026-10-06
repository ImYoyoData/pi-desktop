import type {
	PullRequestCheck,
	PullRequestMergeState,
	PullRequestPermission,
	PullRequestReactionContent,
	PullRequestReviewState,
	PullRequestSummary,
	PullRequestTimelineEvent,
} from "../../../shared/github-types";
import { t } from "@renderer/i18n";

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function formatPullRequestDate(iso: string | undefined, now = Date.now()): string {
	if (!iso) return "";
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) return "";
	return new Date(at).getFullYear() === new Date(now).getFullYear()
		? SHORT_DATE.format(at)
		: LONG_DATE.format(at);
}

export function formatPullRequestRelative(iso: string | undefined): string {
	if (!iso) return "";
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	return formatPullRequestDate(iso);
}

export const REACTION_EMOJI: Record<PullRequestReactionContent, string> = {
	THUMBS_UP: "👍",
	THUMBS_DOWN: "👎",
	LAUGH: "😄",
	HOORAY: "🎉",
	CONFUSED: "😕",
	HEART: "❤️",
	ROCKET: "🚀",
	EYES: "👀",
};

export function reviewStateLabel(state: PullRequestReviewState): string {
	switch (state) {
		case "approved":
			return t.prReviewApproved;
		case "changes-requested":
			return t.prReviewChangesRequested;
		case "commented":
			return t.prComment;
		case "dismissed":
			return t.prReviewApproved;
		default:
			return t.prReviewRequired;
	}
}

export function pullRequestStateLabel(pullRequest: PullRequestSummary): string {
	if (pullRequest.state === "merged") return t.prMerged;
	if (pullRequest.state === "closed") return t.prClosedState;
	return pullRequest.isDraft ? t.prDraft : t.prStateOpen;
}

export function mergeStateLabel(state: PullRequestMergeState): string {
	switch (state) {
		case "clean":
			return t.prMergeStateClean;
		case "blocked":
			return t.prMergeStateBlocked;
		case "behind":
			return t.prMergeStateBehind;
		case "conflicts":
			return t.prMergeStateConflicts;
		case "unstable":
			return t.prMergeStateUnstable;
		case "draft":
			return t.prMergeStateDraft;
		default:
			return t.prMergeStateUnknown;
	}
}

export function timelineEventLabel(event: PullRequestTimelineEvent): string {
	switch (event.kind) {
		case "committed":
			return t.prTimelineCommitted;
		case "labeled":
			return t.prTimelineLabeled;
		case "unlabeled":
			return t.prTimelineUnlabeled;
		case "assigned":
			return t.prTimelineAssigned;
		case "unassigned":
			return t.prTimelineUnassigned;
		case "review-requested":
			return t.prTimelineReviewRequested;
		case "review-request-removed":
			return t.prTimelineReviewRequestRemoved;
		case "renamed":
			return t.prTimelineRenamed;
		case "closed":
			return t.prTimelineClosed;
		case "reopened":
			return t.prTimelineReopened;
		case "merged":
			return t.prTimelineMerged;
		case "ready-for-review":
			return t.prTimelineReady;
		case "converted-to-draft":
			return t.prTimelineDraft;
		case "milestoned":
			return t.prTimelineMilestoned;
		case "demilestoned":
			return t.prTimelineDemilestoned;
		case "base-changed":
			return t.prTimelineBaseChanged;
		case "head-deleted":
			return t.prTimelineHeadDeleted;
		case "head-restored":
			return t.prTimelineHeadRestored;
		case "force-pushed":
			return t.prTimelineForcePushed;
		case "referenced":
			return t.prTimelineReferenced;
		case "cross-referenced":
			return t.prTimelineCrossReferenced;
		default:
			return event.kind;
	}
}

export function checksSummary(checks: PullRequestCheck[] | undefined): { passed: number; failed: number; pending: number; total: number } {
	const list = checks ?? [];
	return {
		passed: list.filter((check) => check.state === "success").length,
		failed: list.filter((check) => check.state === "failure").length,
		pending: list.filter((check) => check.state === "pending").length,
		total: list.length,
	};
}

export function hasWritePermission(permission: PullRequestPermission): boolean {
	return permission === "admin" || permission === "maintain" || permission === "write";
}

export function canTriage(permission: PullRequestPermission): boolean {
	return hasWritePermission(permission) || permission === "triage";
}

export const UNMERGEABLE_STATES: PullRequestMergeState[] = ["conflicts", "blocked", "behind", "draft", "unknown"];

export function canMerge(pullRequest: PullRequestSummary, mergeState: PullRequestMergeState): boolean {
	return !pullRequest.isDraft && !UNMERGEABLE_STATES.includes(mergeState);
}
