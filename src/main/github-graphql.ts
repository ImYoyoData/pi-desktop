import { z } from "zod";
import type {
	PullRequestComment,
	PullRequestLinkedIssue,
	PullRequestMergeMethod,
	PullRequestMilestone,
	PullRequestPermission,
	PullRequestReaction,
	PullRequestReactionContent,
	PullRequestReview,
	PullRequestThread,
	PullRequestTimelineEvent,
} from "../shared/github-types";
import { avatarsOf, type GitHubFailure, imagesOfHtml, type PullRequestAddress } from "./github-core";

export type GraphQLRun = (cwd: string, args: string[]) => Promise<string>;

type CommentExtras = {
	nodeId: string;
	reactions: PullRequestReaction[];
	viewerCanUpdate: boolean;
	viewerCanDelete: boolean;
	outdated?: boolean;
};

type ReviewExtras = { nodeId: string; reactions: PullRequestReaction[] };

export type Enrichment = {
	nodeId: string;
	viewer: string;
	viewerCanUpdate: boolean;
	viewerPermission: PullRequestPermission;
	mergeMethods: PullRequestMergeMethod[];
	reactions: PullRequestReaction[];
	threads: PullRequestThread[];
	avatars: Record<string, string>;
	images: Record<string, string>;
	conversation: Map<number, CommentExtras>;
	review: Map<number, CommentExtras>;
	reviews: Map<number, ReviewExtras>;
	headSha: string;
	milestone: PullRequestMilestone | null;
	linkedIssues: PullRequestLinkedIssue[];
	timeline: PullRequestTimelineEvent[];
	reviewRequests: string[];
	failed: boolean;
};

const EVENT = "id createdAt actor { login }";
const REVIEWER = "requestedReviewer { ... on Actor { login } ... on Team { slug } }";

const FRAGMENTS: Record<string, string> = {
	PULL_REQUEST_COMMIT:
		"... on PullRequestCommit { id commit { oid abbreviatedOid messageHeadline committedDate author { name user { login } } } }",
	HEAD_REF_FORCE_PUSHED_EVENT: `... on HeadRefForcePushedEvent { ${EVENT} beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid } }`,
	LABELED_EVENT: `... on LabeledEvent { ${EVENT} label { name color } }`,
	UNLABELED_EVENT: `... on UnlabeledEvent { ${EVENT} label { name color } }`,
	ASSIGNED_EVENT: `... on AssignedEvent { ${EVENT} assignee { ... on Actor { login } } }`,
	UNASSIGNED_EVENT: `... on UnassignedEvent { ${EVENT} assignee { ... on Actor { login } } }`,
	REVIEW_REQUESTED_EVENT: `... on ReviewRequestedEvent { ${EVENT} ${REVIEWER} }`,
	REVIEW_REQUEST_REMOVED_EVENT: `... on ReviewRequestRemovedEvent { ${EVENT} ${REVIEWER} }`,
	RENAMED_TITLE_EVENT: `... on RenamedTitleEvent { ${EVENT} currentTitle previousTitle }`,
	CLOSED_EVENT: `... on ClosedEvent { ${EVENT} }`,
	REOPENED_EVENT: `... on ReopenedEvent { ${EVENT} }`,
	MERGED_EVENT: `... on MergedEvent { ${EVENT} mergeRefName commit { abbreviatedOid } }`,
	READY_FOR_REVIEW_EVENT: `... on ReadyForReviewEvent { ${EVENT} }`,
	CONVERT_TO_DRAFT_EVENT: `... on ConvertToDraftEvent { ${EVENT} }`,
	MILESTONED_EVENT: `... on MilestonedEvent { ${EVENT} milestoneTitle }`,
	DEMILESTONED_EVENT: `... on DemilestonedEvent { ${EVENT} milestoneTitle }`,
	BASE_REF_CHANGED_EVENT: `... on BaseRefChangedEvent { ${EVENT} currentRefName previousRefName }`,
	HEAD_REF_DELETED_EVENT: `... on HeadRefDeletedEvent { ${EVENT} headRefName }`,
	HEAD_REF_RESTORED_EVENT: `... on HeadRefRestoredEvent { ${EVENT} }`,
	REFERENCED_EVENT: `... on ReferencedEvent { ${EVENT} commit { abbreviatedOid messageHeadline url } }`,
	CROSS_REFERENCED_EVENT: `... on CrossReferencedEvent { ${EVENT} source { ... on Issue { title url } ... on PullRequest { title url } } }`,
};

const TIMELINE_SELECTION = `timelineItems(last: 100, itemTypes: [${Object.keys(FRAGMENTS).join(", ")}]) { nodes { __typename ${Object.values(FRAGMENTS).join(" ")} } }`;

const Text = z.string().optional().catch(undefined);
const Login = z.object({ login: z.string().min(1) }).nullable().optional().catch(null);
const Oid = z.object({ abbreviatedOid: Text }).nullable().optional().catch(null);

const TimelineNodeSchema = z.object({
	__typename: z.string(),
	id: z.string().min(1),
	createdAt: Text,
	actor: Login,
	commit: z
		.object({
			oid: Text,
			abbreviatedOid: Text,
			messageHeadline: Text,
			committedDate: Text,
			url: Text,
			author: z
				.object({ name: z.string().nullable().catch(null), user: Login })
				.nullable()
				.optional()
				.catch(null),
		})
		.nullable()
		.optional()
		.catch(null),
	label: z.object({ name: z.string(), color: Text }).nullable().optional().catch(null),
	assignee: Login,
	requestedReviewer: z.object({ login: Text, slug: Text }).nullable().optional().catch(null),
	currentTitle: Text,
	previousTitle: Text,
	milestoneTitle: Text,
	currentRefName: Text,
	previousRefName: Text,
	headRefName: Text,
	mergeRefName: Text,
	beforeCommit: Oid,
	afterCommit: Oid,
	source: z.object({ title: Text, url: Text }).nullable().optional().catch(null),
});

type TimelineNode = z.infer<typeof TimelineNodeSchema>;

const MAPPINGS: Record<
	string,
	{
		kind: string;
		subject?: (node: TimelineNode) => string | undefined;
		detail?: (node: TimelineNode) => string | undefined;
	}
> = {
	PullRequestCommit: {
		kind: "committed",
		subject: (node) => node.commit?.messageHeadline,
		detail: (node) => node.commit?.abbreviatedOid,
	},
	HeadRefForcePushedEvent: {
		kind: "force-pushed",
		subject: (node) => node.beforeCommit?.abbreviatedOid,
		detail: (node) => node.afterCommit?.abbreviatedOid,
	},
	LabeledEvent: {
		kind: "labeled",
		subject: (node) => node.label?.name,
		detail: (node) => node.label?.color,
	},
	UnlabeledEvent: {
		kind: "unlabeled",
		subject: (node) => node.label?.name,
		detail: (node) => node.label?.color,
	},
	AssignedEvent: { kind: "assigned", subject: (node) => node.assignee?.login },
	UnassignedEvent: { kind: "unassigned", subject: (node) => node.assignee?.login },
	ReviewRequestedEvent: {
		kind: "review-requested",
		subject: (node) => node.requestedReviewer?.login ?? node.requestedReviewer?.slug,
	},
	ReviewRequestRemovedEvent: {
		kind: "review-request-removed",
		subject: (node) => node.requestedReviewer?.login ?? node.requestedReviewer?.slug,
	},
	RenamedTitleEvent: {
		kind: "renamed",
		subject: (node) => node.currentTitle,
		detail: (node) => node.previousTitle,
	},
	ClosedEvent: { kind: "closed" },
	ReopenedEvent: { kind: "reopened" },
	MergedEvent: {
		kind: "merged",
		subject: (node) => node.mergeRefName,
		detail: (node) => node.commit?.abbreviatedOid,
	},
	ReadyForReviewEvent: { kind: "ready-for-review" },
	ConvertToDraftEvent: { kind: "converted-to-draft" },
	MilestonedEvent: { kind: "milestoned", subject: (node) => node.milestoneTitle },
	DemilestonedEvent: { kind: "demilestoned", subject: (node) => node.milestoneTitle },
	BaseRefChangedEvent: {
		kind: "base-changed",
		subject: (node) => node.currentRefName,
		detail: (node) => node.previousRefName,
	},
	HeadRefDeletedEvent: { kind: "head-deleted", subject: (node) => node.headRefName },
	HeadRefRestoredEvent: { kind: "head-restored" },
	ReferencedEvent: {
		kind: "referenced",
		subject: (node) => node.commit?.messageHeadline,
		detail: (node) => node.commit?.url,
	},
	CrossReferencedEvent: {
		kind: "cross-referenced",
		subject: (node) => node.source?.title,
		detail: (node) => node.source?.url,
	},
};

function actorOf(node: TimelineNode): string {
	if (node.__typename !== "PullRequestCommit") return node.actor?.login ?? "";
	const author = node.commit?.author;
	return author?.user?.login ?? author?.name ?? "";
}

function atOf(node: TimelineNode): string {
	if (node.__typename === "PullRequestCommit") return node.commit?.committedDate ?? "";
	return node.createdAt ?? "";
}

function oidOf(node: TimelineNode): string | undefined {
	if (node.__typename !== "PullRequestCommit") return undefined;
	return node.commit?.oid;
}

function eventOf(entry: unknown): PullRequestTimelineEvent[] {
	const parsed = TimelineNodeSchema.safeParse(entry);
	if (!parsed.success) return [];
	const node = parsed.data;
	const mapping = MAPPINGS[node.__typename];
	const at = atOf(node);
	if (!mapping || !at) return [];
	const subject = mapping.subject?.(node);
	const detail = mapping.detail?.(node);
	const oid = oidOf(node);
	return [
		{
			id: node.id,
			kind: mapping.kind,
			actor: actorOf(node),
			at,
			...(subject ? { subject } : {}),
			...(detail ? { detail } : {}),
			...(oid ? { oid } : {}),
		},
	];
}

function timelineOf(items: unknown[]): PullRequestTimelineEvent[] {
	return items.flatMap(eventOf).sort((left, right) => left.at.localeCompare(right.at));
}

const MERGE_METHODS: PullRequestMergeMethod[] = ["squash", "merge", "rebase"];
const REACTIONS = "reactionGroups { content viewerHasReacted reactors { totalCount } }";
const AUTHOR = "author { __typename login avatarUrl }";
const COMMENT = `databaseId id viewerCanUpdate viewerCanDelete bodyHTML ${AUTHOR} ${REACTIONS}`;
const REVIEW_REQUESTS =
	"reviewRequests(first: 50) { nodes { requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Team { combinedSlug } } } }";
const OLDER = "pageInfo { hasPreviousPage startCursor }";
const NEWER = "pageInfo { hasNextPage endCursor }";
const THREAD_COMMENTS = `${NEWER} nodes { ${COMMENT} outdated }`;
const MAX_OLDER_PAGES = 10;
const MAX_THREAD_COMMENT_PAGES = 5;

type ConnectionItem = z.ZodTypeAny;

const SELECTIONS: Record<string, string> = {
	comments: `${OLDER} nodes { ${COMMENT} }`,
	reviews: `${OLDER} nodes { databaseId id bodyHTML ${AUTHOR} ${REACTIONS} }`,
	reviewThreads: `${OLDER} nodes { id isResolved viewerCanResolve viewerCanUnresolve comments(first: 100) { ${THREAD_COMMENTS} } }`,
};

function olderPageQuery(connection: string): string {
	return [
		"query($owner: String!, $name: String!, $number: Int!, $cursor: String!) {",
		"repository(owner: $owner, name: $name) {",
		"pullRequest(number: $number) {",
		`${connection}(last: 100, before: $cursor) { ${SELECTIONS[connection]} }`,
		"}",
		"}",
		"}",
	].join(" ");
}

const THREAD_COMMENTS_QUERY = [
	"query($threadId: ID!, $cursor: String!) {",
	"node(id: $threadId) {",
	`... on PullRequestReviewThread { comments(first: 100, after: $cursor) { ${THREAD_COMMENTS} } }`,
	"}",
	"}",
].join(" ");

const PULL_REQUEST_ENRICHMENT_QUERY = [
	"query($owner: String!, $name: String!, $number: Int!) {",
	"viewer { login }",
	"repository(owner: $owner, name: $name) {",
	"viewerPermission squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed",
	"pullRequest(number: $number) {",
	`id headRefOid viewerCanUpdate bodyHTML ${AUTHOR} ${REACTIONS}`,
	"milestone { number title dueOn }",
	"closingIssuesReferences(first: 20) { nodes { number title url state } }",
	REVIEW_REQUESTS,
	`comments(last: 100) { ${SELECTIONS.comments} }`,
	`reviews(last: 100) { ${SELECTIONS.reviews} }`,
	`reviewThreads(last: 100) { ${SELECTIONS.reviewThreads} }`,
	TIMELINE_SELECTION,
	"}",
	"}",
	"}",
].join(" ");

function lenientArray<T extends z.ZodTypeAny>(item: T) {
	return z
		.array(z.unknown())
		.catch([])
		.transform((items) =>
			items.flatMap((entry) => {
				const parsed = item.safeParse(entry);
				return parsed.success ? [parsed.data as z.infer<T>] : [];
			}),
		);
}

function nodes<T extends z.ZodTypeAny>(item: T) {
	return z
		.object({ nodes: lenientArray(item) })
		.nullable()
		.catch(null)
		.transform((connection) => connection?.nodes ?? []);
}

type Page<T> = { nodes: T[]; before: string | null; after: string | null };

const EMPTY_PAGE: Page<never> = { nodes: [], before: null, after: null };

const PageInfoSchema = z
	.object({
		hasPreviousPage: z.boolean().catch(false),
		startCursor: z.string().min(1).nullable().catch(null),
		hasNextPage: z.boolean().catch(false),
		endCursor: z.string().min(1).nullable().catch(null),
	})
	.partial()
	.catch({});

function cursorOf(more: boolean | undefined, cursor: string | null | undefined): string | null {
	return more && cursor ? cursor : null;
}

function page<T extends z.ZodTypeAny>(item: T) {
	return z
		.object({ nodes: lenientArray(item), pageInfo: PageInfoSchema })
		.nullable()
		.catch(null)
		.transform((connection): Page<z.infer<T>> => {
			if (!connection) return EMPTY_PAGE as Page<z.infer<T>>;
			const info = connection.pageInfo;
			return {
				nodes: connection.nodes,
				before: cursorOf(info.hasPreviousPage, info.startCursor),
				after: cursorOf(info.hasNextPage, info.endCursor),
			};
		});
}

const ReactionGroupSchema = z.object({
	content: z.enum(["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"]),
	viewerHasReacted: z.boolean().catch(false),
	reactors: z.object({ totalCount: z.number().int().nonnegative() }).catch({ totalCount: 0 }),
});

const AuthorSchema = z
	.object({
		__typename: z.string().optional().catch(undefined),
		login: z.string().min(1),
		avatarUrl: z.string().catch(""),
	})
	.nullable()
	.catch(null);

const Reactable = {
	id: z.string().min(1),
	bodyHTML: z.string().catch(""),
	author: AuthorSchema,
	reactionGroups: lenientArray(ReactionGroupSchema),
};

const CommentSchema = z.object({
	...Reactable,
	databaseId: z.number().int().positive(),
	viewerCanUpdate: z.boolean().catch(false),
	viewerCanDelete: z.boolean().catch(false),
});

const ReviewCommentSchema = CommentSchema.extend({ outdated: z.boolean().catch(false) });

const GraphQLReviewSchema = z.object({ ...Reactable, databaseId: z.number().int().positive() });

const ThreadSchema = z.object({
	id: z.string().min(1),
	isResolved: z.boolean().catch(false),
	viewerCanResolve: z.boolean().catch(false),
	viewerCanUnresolve: z.boolean().catch(false),
	comments: page(ReviewCommentSchema),
});

const MilestoneSchema = z
	.object({ number: z.number().int().positive(), title: z.string().min(1), dueOn: z.string().nullable().catch(null) })
	.nullable()
	.catch(null);

const ReviewRequestSchema = z
	.object({
		requestedReviewer: z.union([
			z.object({ login: z.string().min(1) }).transform((user) => user.login),
			z.object({ combinedSlug: z.string().min(1) }).transform((team) => team.combinedSlug),
		]),
	})
	.transform((request) => request.requestedReviewer);

const LinkedIssueSchema = z.object({
	number: z.number().int().positive(),
	title: z.string().catch(""),
	url: z.url({ protocol: /^https$/ }),
	state: z.enum(["OPEN", "CLOSED"]),
});

const PullRequestEnrichmentSchema = z.object({
	data: z.object({
		viewer: z.object({ login: z.string() }).catch({ login: "" }),
		repository: z.object({
			viewerPermission: z.string().nullable().catch(null),
			squashMergeAllowed: z.boolean().catch(false),
			mergeCommitAllowed: z.boolean().catch(false),
			rebaseMergeAllowed: z.boolean().catch(false),
			pullRequest: z.object({
				...Reactable,
				headRefOid: z
					.string()
					.regex(/^[0-9a-f]{40,64}$/)
					.catch(""),
				viewerCanUpdate: z.boolean().catch(false),
				milestone: MilestoneSchema,
				closingIssuesReferences: nodes(LinkedIssueSchema),
				reviewRequests: nodes(ReviewRequestSchema),
				comments: page(CommentSchema),
				reviews: page(GraphQLReviewSchema),
				reviewThreads: page(ThreadSchema),
				timelineItems: z
					.object({ nodes: z.array(z.unknown()).catch([]) })
					.nullable()
					.catch(null),
			}),
		}),
	}),
});

type ParsedEnrichment = z.infer<typeof PullRequestEnrichmentSchema>;
type ParsedPullRequest = ParsedEnrichment["data"]["repository"]["pullRequest"];

const EMPTY_ENRICHMENT: Enrichment = {
	nodeId: "",
	viewer: "",
	viewerCanUpdate: false,
	viewerPermission: "none",
	mergeMethods: [],
	reactions: [],
	threads: [],
	avatars: {},
	images: {},
	conversation: new Map(),
	review: new Map(),
	reviews: new Map(),
	headSha: "",
	milestone: null,
	linkedIssues: [],
	timeline: [],
	reviewRequests: [],
	failed: false,
};

const FAILED_ENRICHMENT: Enrichment = { ...EMPTY_ENRICHMENT, failed: true };

const PERMISSIONS: Record<string, PullRequestPermission> = {
	ADMIN: "admin",
	MAINTAIN: "maintain",
	WRITE: "write",
	TRIAGE: "triage",
	READ: "read",
};

function permissionOf(value: string | null | undefined): PullRequestPermission {
	return PERMISSIONS[value?.toUpperCase() ?? ""] ?? "none";
}

function mergeMethodsOf(repository: {
	squashMergeAllowed: boolean;
	mergeCommitAllowed: boolean;
	rebaseMergeAllowed: boolean;
}): PullRequestMergeMethod[] {
	const allowed: Record<PullRequestMergeMethod, boolean> = {
		squash: repository.squashMergeAllowed,
		merge: repository.mergeCommitAllowed,
		rebase: repository.rebaseMergeAllowed,
	};
	return MERGE_METHODS.filter((method) => allowed[method]);
}

function reactionsOf(groups: z.infer<typeof ReactionGroupSchema>[]): PullRequestReaction[] {
	return groups.flatMap((group) => {
		const count = group.reactors.totalCount;
		if (count === 0 && !group.viewerHasReacted) return [];
		return [
			{
				content: group.content as PullRequestReactionContent,
				count,
				viewerHasReacted: group.viewerHasReacted,
			},
		];
	});
}

function commentExtras(
	comments: (z.infer<typeof CommentSchema> & { outdated?: boolean })[],
): Map<number, CommentExtras> {
	return new Map(
		comments.map((comment) => [
			comment.databaseId,
			{
				nodeId: comment.id,
				reactions: reactionsOf(comment.reactionGroups),
				viewerCanUpdate: comment.viewerCanUpdate,
				viewerCanDelete: comment.viewerCanDelete,
				...(comment.outdated === undefined ? {} : { outdated: comment.outdated }),
			},
		]),
	);
}

function threadOf(thread: z.infer<typeof ThreadSchema>): PullRequestThread[] {
	const root = thread.comments.nodes[0];
	if (!root) return [];
	return [
		{
			id: thread.id,
			rootCommentId: root.databaseId,
			isResolved: thread.isResolved,
			viewerCanResolve: thread.viewerCanResolve,
			viewerCanUnresolve: thread.viewerCanUnresolve,
		},
	];
}

function milestoneOf(milestone: z.infer<typeof MilestoneSchema>): PullRequestMilestone | null {
	if (!milestone) return null;
	return {
		number: milestone.number,
		title: milestone.title,
		...(milestone.dueOn ? { dueOn: milestone.dueOn } : {}),
	};
}

type Collected = {
	comments: z.infer<typeof CommentSchema>[];
	reviews: z.infer<typeof GraphQLReviewSchema>[];
	threads: z.infer<typeof ThreadSchema>[];
};

function firstPageOf(pullRequest: ParsedPullRequest): Collected {
	return {
		comments: pullRequest.comments.nodes,
		reviews: pullRequest.reviews.nodes,
		threads: pullRequest.reviewThreads.nodes,
	};
}

function enrichmentOf(parsed: ParsedEnrichment, collected: Collected = firstPageOf(parsed.data.repository.pullRequest)): Enrichment {
	const repository = parsed.data.repository;
	const pullRequest = repository.pullRequest;
	const threadComments = collected.threads.flatMap((thread) => thread.comments.nodes);
	const authored = [pullRequest, ...collected.comments, ...collected.reviews, ...threadComments];
	const avatars: Record<string, string> = {};
	const images: Record<string, string> = {};
	for (const entry of authored) {
		Object.assign(avatars, avatarsOf(entry.author));
		Object.assign(images, imagesOfHtml(entry.bodyHTML));
	}
	return {
		nodeId: pullRequest.id,
		viewer: parsed.data.viewer.login,
		viewerCanUpdate: pullRequest.viewerCanUpdate,
		viewerPermission: permissionOf(repository.viewerPermission),
		mergeMethods: mergeMethodsOf(repository),
		reactions: reactionsOf(pullRequest.reactionGroups),
		threads: collected.threads.flatMap(threadOf),
		avatars,
		images,
		conversation: commentExtras(collected.comments),
		review: commentExtras(threadComments),
		reviews: new Map(
			collected.reviews.map((review) => [review.databaseId, { nodeId: review.id, reactions: reactionsOf(review.reactionGroups) }]),
		),
		headSha: pullRequest.headRefOid,
		milestone: milestoneOf(pullRequest.milestone),
		linkedIssues: pullRequest.closingIssuesReferences.map((issue) => ({
			number: issue.number,
			title: issue.title,
			url: issue.url,
			state: issue.state === "OPEN" ? "open" : "closed",
		})),
		timeline: timelineOf(pullRequest.timelineItems?.nodes ?? []),
		reviewRequests: pullRequest.reviewRequests,
		failed: false,
	};
}

const ThreadCommentsPageSchema = z
	.object({ data: z.object({ node: z.object({ comments: page(ReviewCommentSchema) }) }) })
	.transform((response) => response.data.node.comments);

type GraphQLRequest = {
	cwd: string;
	hostname: string;
	owner: string;
	name: string;
	number: number;
	run: GraphQLRun;
};

function responseOf(output: string): ParsedEnrichment | null {
	let json: unknown;
	try {
		json = JSON.parse(output);
	} catch {
		return null;
	}
	const parsed = PullRequestEnrichmentSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

function pullRequestArgs(request: GraphQLRequest, query: string, extra: string[]): string[] {
	return [
		"api",
		"graphql",
		"--hostname",
		request.hostname,
		"-f",
		`query=${query}`,
		"-f",
		`owner=${request.owner}`,
		"-f",
		`name=${request.name}`,
		"-F",
		`number=${request.number}`,
		...extra,
	];
}

async function readOutput(request: GraphQLRequest, args: string[]): Promise<string | null> {
	try {
		return await request.run(request.cwd, args);
	} catch {
		return null;
	}
}

async function readPage<T>(request: GraphQLRequest, args: string[], schema: z.ZodType<T>): Promise<T | null> {
	const output = await readOutput(request, args);
	if (output === null) return null;
	try {
		const parsed = schema.safeParse(JSON.parse(output));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function olderPage<T extends ConnectionItem>(request: GraphQLRequest, connection: string, item: T) {
	const schema = z
		.object({
			data: z.object({
				repository: z.object({ pullRequest: z.object({ [connection]: page(item) }) }),
			}),
		})
		.transform(
			(response) =>
				(response.data.repository.pullRequest as Record<string, Page<z.infer<T>>>)[connection] ??
				(EMPTY_PAGE as Page<z.infer<T>>),
		);
	return (cursor: string): Promise<Page<z.infer<T>> | null> =>
		readPage(request, pullRequestArgs(request, olderPageQuery(connection), ["-f", `cursor=${cursor}`]), schema);
}

function laterThreadComments(request: GraphQLRequest, threadId: string) {
	return (cursor: string): Promise<Page<z.infer<typeof ReviewCommentSchema>> | null> =>
		readPage(
			request,
			[
				"api",
				"graphql",
				"--hostname",
				request.hostname,
				"-f",
				`query=${THREAD_COMMENTS_QUERY}`,
				"-f",
				`threadId=${threadId}`,
				"-f",
				`cursor=${cursor}`,
			],
			ThreadCommentsPageSchema,
		);
}

async function olderNodes<T>(
	fetchPage: (cursor: string) => Promise<Page<T> | null>,
	cursor: string | null,
	remaining: number,
): Promise<T[]> {
	if (!cursor || remaining === 0) return [];
	const older = await fetchPage(cursor);
	if (!older) return [];
	const oldest = await olderNodes(fetchPage, older.before, remaining - 1);
	return [...oldest, ...older.nodes];
}

async function laterNodes<T>(
	fetchPage: (cursor: string) => Promise<Page<T> | null>,
	cursor: string | null,
	remaining: number,
): Promise<T[]> {
	if (!cursor || remaining === 0) return [];
	const later = await fetchPage(cursor);
	if (!later) return [];
	const latest = await laterNodes(fetchPage, later.after, remaining - 1);
	return [...later.nodes, ...latest];
}

async function withLaterComments(request: GraphQLRequest, thread: z.infer<typeof ThreadSchema>) {
	if (!thread.comments.after) return thread;
	const later = await laterNodes(
		laterThreadComments(request, thread.id),
		thread.comments.after,
		MAX_THREAD_COMMENT_PAGES,
	);
	const nodes = [...thread.comments.nodes, ...later];
	return { ...thread, comments: { ...thread.comments, nodes, after: null } };
}

async function collect(request: GraphQLRequest, pullRequest: ParsedPullRequest): Promise<Collected> {
	const [comments, reviews, threads] = await Promise.all([
		olderNodes(olderPage(request, "comments", CommentSchema), pullRequest.comments.before, MAX_OLDER_PAGES),
		olderNodes(olderPage(request, "reviews", GraphQLReviewSchema), pullRequest.reviews.before, MAX_OLDER_PAGES),
		olderNodes(olderPage(request, "reviewThreads", ThreadSchema), pullRequest.reviewThreads.before, MAX_OLDER_PAGES),
	]);
	const allThreads = [...threads, ...pullRequest.reviewThreads.nodes];
	return {
		comments: [...comments, ...pullRequest.comments.nodes],
		reviews: [...reviews, ...pullRequest.reviews.nodes],
		threads: await Promise.all(allThreads.map((thread) => withLaterComments(request, thread))),
	};
}

export async function fetchPullRequestEnrichment(
	cwd: string,
	address: PullRequestAddress,
	run: GraphQLRun,
): Promise<Enrichment> {
	const [owner, name] = address.repository.split("/");
	if (!owner || !name) return FAILED_ENRICHMENT;
	const request: GraphQLRequest = {
		cwd,
		hostname: address.hostname,
		owner,
		name,
		number: address.number,
		run,
	};
	const output = await readOutput(request, pullRequestArgs(request, PULL_REQUEST_ENRICHMENT_QUERY, []));
	if (output === null) return FAILED_ENRICHMENT;
	const parsed = responseOf(output);
	if (!parsed) return FAILED_ENRICHMENT;
	const collected = await collect(request, parsed.data.repository.pullRequest);
	return enrichmentOf(parsed, collected);
}

export function enrichComment(comment: PullRequestComment, enrichment: Enrichment): PullRequestComment {
	if (comment.kind === "conversation") {
		const extras = enrichment.conversation.get(comment.id);
		return extras ? { ...comment, ...extras } : comment;
	}
	const extras = enrichment.review.get(comment.id);
	if (!extras) return comment;
	const outdated = Boolean(comment.outdated || extras.outdated);
	return { ...comment, ...extras, outdated };
}

export function enrichReview(review: PullRequestReview, enrichment: Enrichment): PullRequestReview {
	const extras = enrichment.reviews.get(review.id);
	return extras ? { ...review, ...extras } : review;
}

export type { GitHubFailure };
