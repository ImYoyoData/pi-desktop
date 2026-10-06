export type GitHubFailureReason =
	| "cancelled"
	| "not-installed"
	| "too-large"
	| "timed-out"
	| "not-github"
	| "unavailable"
	| "not-authenticated"
	| "invalid-response"
	| "failed";

export type PullRequestState = "open" | "merged" | "closed";

export type PullRequestCheckState = "success" | "failure" | "pending" | "none";

export type PullRequestCheck = {
	name: string;
	state: PullRequestCheckState;
	url?: string;
};

export type PullRequestReviewDecision = "approved" | "changes-requested" | "review-required";

export type PullRequestPerson = { login: string; avatarUrl?: string };

export type PullRequestLabel = { name: string; color: string };

/** 列表行、分支查询与聊天徽章共用的精简 PR 记录。 */
export type PullRequestSummary = {
	number: number;
	title: string;
	url: string;
	state: PullRequestState;
	isDraft?: boolean;
	repo?: string;
	headBranch?: string;
	baseBranch?: string;
	additions?: number;
	deletions?: number;
	repoFullName?: string;
	author?: string;
	createdAt?: string;
	updatedAt?: string;
	changedFiles?: number;
	reviewDecision?: PullRequestReviewDecision;
	checks?: PullRequestCheck[];
	authorAvatarUrl?: string;
	labels?: PullRequestLabel[];
	commentCount?: number;
	assignees?: PullRequestPerson[];
	requestedReviewers?: PullRequestPerson[];
	parent?: PullRequestSummary;
};

export type PullRequestCommentKind = "conversation" | "review";

export type PullRequestCommentSide = "LEFT" | "RIGHT";

export type PullRequestComment = {
	id: number;
	author: string;
	body: string;
	createdAt: string;
	kind: PullRequestCommentKind;
	path?: string;
	line?: number;
	diffHunk?: string;
	inReplyToId?: number;
	reviewId?: number;
	side?: PullRequestCommentSide;
	startLine?: number;
	outdated?: boolean;
	nodeId?: string;
	reactions?: PullRequestReaction[];
	viewerCanUpdate?: boolean;
	viewerCanDelete?: boolean;
};

export type PullRequestReviewState =
	| "approved"
	| "changes-requested"
	| "commented"
	| "dismissed"
	| "pending";

export type PullRequestReview = {
	id: number;
	author: string;
	state: PullRequestReviewState;
	body: string;
	submittedAt: string;
	commit?: string;
	nodeId?: string;
	reactions?: PullRequestReaction[];
};

export type PullRequestReactionContent =
	| "THUMBS_UP"
	| "THUMBS_DOWN"
	| "LAUGH"
	| "HOORAY"
	| "CONFUSED"
	| "HEART"
	| "ROCKET"
	| "EYES";

export type PullRequestReaction = {
	content: PullRequestReactionContent;
	count: number;
	viewerHasReacted: boolean;
};

export type PullRequestThread = {
	id: string;
	rootCommentId: number;
	isResolved: boolean;
	viewerCanResolve: boolean;
	viewerCanUnresolve: boolean;
};

export type PullRequestCommit = {
	oid: string;
	headline: string;
	author: string;
	authoredAt: string;
};

export type PullRequestFile = {
	path: string;
	additions: number;
	deletions: number;
};

export type PullRequestTimelineEvent = {
	id: string;
	kind: string;
	actor: string;
	at: string;
	subject?: string;
	detail?: string;
	oid?: string;
};

export type PullRequestMilestone = { number: number; title: string; dueOn?: string };

export type PullRequestLinkedIssue = {
	number: number;
	title: string;
	url: string;
	state: "open" | "closed";
};

export type PullRequestMergeState =
	| "clean"
	| "blocked"
	| "behind"
	| "conflicts"
	| "unstable"
	| "draft"
	| "unknown";

export type PullRequestMergeMethod = "squash" | "merge" | "rebase";

export type PullRequestPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export type PullRequestDetail = {
	pullRequest: PullRequestSummary;
	body: string;
	commits: PullRequestCommit[];
	files: PullRequestFile[];
	reviews: PullRequestReview[];
	comments: PullRequestComment[];
	reviewRequests: string[];
	assignees: string[];
	labels: PullRequestLabel[];
	mergeState: PullRequestMergeState;
	nodeId: string;
	viewer: string;
	viewerCanUpdate: boolean;
	viewerPermission: PullRequestPermission;
	mergeMethods: PullRequestMergeMethod[];
	reactions: PullRequestReaction[];
	threads: PullRequestThread[];
	avatars: Record<string, string>;
	images: Record<string, string>;
	headSha: string;
	milestone: PullRequestMilestone | null;
	linkedIssues: PullRequestLinkedIssue[];
	timeline: PullRequestTimelineEvent[];
	enrichmentFailed: boolean;
};

export type PullRequestPatchResult = {
	patch: string;
	headSha: string;
	stale: boolean;
};

export type PullRequestListState = "open" | "closed" | "merged" | "all";

export type PullRequestListAuthor = "mine" | "all";

export type PullRequestSort =
	| "updated-desc"
	| "updated-asc"
	| "created-desc"
	| "created-asc"
	| "comments-desc"
	| "comments-asc"
	| "reactions-desc"
	| "interactions-desc";

export type PullRequestFilters = {
	text?: string;
	author?: string;
	assignee?: string | "none";
	mentions?: string;
	involves?: string;
	commenter?: string;
	reviewRequested?: string;
	reviewedBy?: string;
	review?: "none" | "required" | "approved" | "changes-requested";
	checks?: PullRequestCheckState;
	draft?: boolean;
	labels?: string[];
	noLabel?: boolean;
	milestone?: string;
	base?: string;
	head?: string;
	linked?: "issue";
	createdAfter?: string;
	updatedAfter?: string;
	updatedWithin?: 7 | 30;
	sort?: PullRequestSort;
};

export type PullRequestCounts = { open: number; closed: number; merged: number };

export type PullRequestPage = {
	pullRequests: PullRequestSummary[];
	nextCursor: string | null;
	totalCount: number;
	repository: string;
	counts?: PullRequestCounts;
};

export type PullRequestListRequest = {
	cwd: string;
	state: PullRequestListState;
	author: PullRequestListAuthor;
	cursor?: string;
	filters?: PullRequestFilters;
	requestId?: string;
};

export type PullRequestChoiceKind = "labels" | "people" | "milestones" | "branches";

export type PullRequestChoices = {
	labels?: PullRequestLabel[];
	people?: string[];
	milestones?: PullRequestMilestone[];
	branches?: string[];
};

export type PullRequestAction =
	| { kind: "comment"; body: string }
	| { kind: "reply"; commentId: number; body: string }
	| { kind: "edit-comment"; target: PullRequestCommentKind; commentId: number; body: string }
	| { kind: "delete-comment"; target: PullRequestCommentKind; commentId: number }
	| { kind: "edit-description"; body: string }
	| { kind: "edit-title"; title: string }
	| { kind: "react"; subjectId: string; content: PullRequestReactionContent; add: boolean }
	| { kind: "review"; event: "approve" | "request-changes" | "comment"; body: string }
	| { kind: "resolve-thread"; threadId: string; resolved: boolean }
	| { kind: "labels"; add: string[]; remove: string[] }
	| { kind: "assignees"; add: string[]; remove: string[] }
	| { kind: "reviewers"; add: string[]; remove: string[] }
	| { kind: "state"; state: "close" | "reopen" | "ready" | "draft" }
	| { kind: "merge"; method: PullRequestMergeMethod; headSha: string }
	| {
			kind: "line-comment";
			path: string;
			line: number;
			side: PullRequestCommentSide;
			startLine?: number;
			body: string;
			commitId?: string;
	  }
	| { kind: "milestone"; title: string | null }
	| { kind: "update-branch"; rebase: boolean }
	| { kind: "rerun-checks"; urls: string[]; failedOnly: boolean };

export type GitHubResult<T> = { success: true } & T;
export type GitHubFailure = { success: false; error: string; cancelled?: boolean };
export type GitHubResponse<T> = GitHubResult<T> | GitHubFailure;

export type GitHubImageResult = { success: true; dataUrl: string } | { success: false; error: string };
