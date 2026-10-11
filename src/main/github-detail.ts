import { z } from "zod";
import type {
	PullRequestDetail,
	PullRequestFile,
	PullRequestLabel,
	PullRequestMergeMethod,
	PullRequestMergeState,
	PullRequestPatchResult,
	PullRequestReview,
	PullRequestReviewState,
	PullRequestSummary,
} from "../shared/github-types";
import {
	countOf,
	CONVERSATION_COMMENTS_JQ,
	githubError,
	isGitHubError,
	PULL_REQUEST_FIELDS,
	parseJsonLines,
	parsePullRequestComments,
	pullRequestAddress,
	pullRequestsOfRecords,
	REVIEW_COMMENTS_JQ,
} from "./github-core";
import { enrichComment, enrichReview, fetchPullRequestEnrichment, type GraphQLRun } from "./github-graphql";

const DETAIL_FIELDS = [...PULL_REQUEST_FIELDS, "body", "reviewRequests", "assignees", "labels", "mergeStateStatus"].join(",");

const Login = z.object({ login: z.string().min(1) });

const DetailSchema = z.object({
	body: z.string().catch(""),
	reviewRequests: z.array(z.unknown()).catch([]),
	assignees: z.array(Login.transform((assignee) => assignee.login)).catch([]),
	labels: z
		.array(
			z.object({
				name: z.string().min(1),
				color: z
					.string()
					.regex(/^[0-9a-fA-F]{6}$/)
					.catch("8b949e"),
			}),
		)
		.catch([]),
	mergeStateStatus: z.string().catch(""),
});

const TeamSchema = z.object({
	slug: z.string().min(1),
	organization: z.object({ login: z.string().min(1) }).optional(),
});

const FileSchema = z.object({
	path: z.string().min(1),
	additions: z.number().int().nonnegative().catch(0),
	deletions: z.number().int().nonnegative().catch(0),
});

const DetailCommitSchema = z.object({
	oid: z.string().min(7),
	headline: z.string().catch(""),
	author: z.string().catch(""),
	authoredAt: z.string().catch(""),
});

const DetailReviewSchema = z.object({
	id: z.number().int().positive(),
	user: Login.nullable(),
	body: z.string().nullable().catch(""),
	state: z.string(),
	submitted_at: z.string().nullable().catch(null),
	commit_id: z.string().nullable().catch(null),
});

const REVIEW_STATES: Record<string, PullRequestReviewState> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	COMMENTED: "commented",
	DISMISSED: "dismissed",
	PENDING: "pending",
};

const MERGE_STATES: Record<string, PullRequestMergeState> = {
	CLEAN: "clean",
	HAS_HOOKS: "clean",
	BLOCKED: "blocked",
	BEHIND: "behind",
	DIRTY: "conflicts",
	UNSTABLE: "unstable",
	DRAFT: "draft",
};

function invalid(message: string) {
	return githubError({ reason: "invalid-response", message });
}

function reviewsOf(output: string): PullRequestReview[] {
	return parseJsonLines(output).flatMap((entry) => {
		const parsed = DetailReviewSchema.safeParse(entry);
		if (!parsed.success) return [];
		const review = parsed.data;
		const state = REVIEW_STATES[review.state.toUpperCase()];
		if (!state || !review.submitted_at) return [];
		return [
			{
				id: review.id,
				author: review.user?.login ?? "ghost",
				state,
				body: review.body ?? "",
				submittedAt: review.submitted_at,
				...(review.commit_id ? { commit: review.commit_id } : {}),
			},
		];
	});
}

function reviewRequestsOf(requests: unknown[], owner: string): string[] {
	return requests.flatMap((entry) => {
		const login = Login.safeParse(entry);
		if (login.success) return [login.data.login];
		const team = TeamSchema.safeParse(entry);
		if (!team.success) return [];
		if (team.data.slug.includes("/")) return [team.data.slug];
		const org = team.data.organization?.login ?? owner;
		return [`${org}/${team.data.slug}`];
	});
}

function withRequested(listed: string[], requested: string[]): string[] {
	const seen = new Set(listed.map((name) => name.toLowerCase()));
	const added = requested.filter((name) => {
		const key = name.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return [...listed, ...added];
}

function linesOf<T>(output: string, schema: z.ZodType<T>): T[] {
	return parseJsonLines(output).flatMap((entry) => {
		const parsed = schema.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}

function jsonOf(output: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		throw invalid("GitHub returned an unreadable pull request.");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw invalid("GitHub returned an unreadable pull request.");
	}
	return parsed as Record<string, unknown>;
}

function paginated(address: { hostname: string; repository: string }, path: string, jq = ".[]"): string[] {
	return ["api", "--hostname", address.hostname, "--paginate", `repos/${address.repository}/${path}`, "--jq", jq];
}

const FILES_JQ = ".[] | {path: .filename, additions, deletions}";
const REVIEWS_JQ =
	'.[] | {id, body, state, submitted_at, commit_id, user: (.user | if type == "object" then {login} else null end)}';
const COMMITS_JQ =
	'.[] | {oid: .sha, headline: (.commit.message | split("\\n")[0]), author: (.author.login // .commit.author.name // ""), authoredAt: (.commit.author.date // "")}';

export async function fetchPullRequestDetail(cwd: string, url: string, run: GraphQLRun): Promise<PullRequestDetail> {
	const address = pullRequestAddress(url);
	const pulls = `pulls/${address.number}`;
	const [view, reviews, conversation, review, files, commits, enrichment] = await Promise.all([
		run(cwd, ["pr", "view", url, "--json", DETAIL_FIELDS]),
		run(cwd, paginated(address, `${pulls}/reviews?per_page=100`, REVIEWS_JQ)),
		run(cwd, paginated(address, `issues/${address.number}/comments?per_page=100`, CONVERSATION_COMMENTS_JQ)),
		run(cwd, paginated(address, `${pulls}/comments?per_page=100`, REVIEW_COMMENTS_JQ)),
		run(cwd, paginated(address, `${pulls}/files?per_page=100`, FILES_JQ)),
		run(cwd, paginated(address, `${pulls}/commits?per_page=100`, COMMITS_JQ)),
		fetchPullRequestEnrichment(cwd, address, run),
	]);
	const record = jsonOf(view);
	const [pullRequest] = pullRequestsOfRecords([record]);
	const detail = DetailSchema.safeParse(record);
	if (!pullRequest || !detail.success) throw invalid("GitHub returned an invalid pull request.");
	const data = detail.data;
	return {
		pullRequest,
		body: data.body,
		commits: linesOf(commits, DetailCommitSchema),
		files: linesOf<PullRequestFile>(files, FileSchema),
		reviews: reviewsOf(reviews).map((entry) => enrichReview(entry, enrichment)),
		comments: [
			...parsePullRequestComments(conversation, "conversation"),
			...parsePullRequestComments(review, "review"),
		]
			.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
			.map((comment) => enrichComment(comment, enrichment)),
		reviewRequests: withRequested(
			reviewRequestsOf(data.reviewRequests, address.repository.split("/")[0] ?? ""),
			enrichment.reviewRequests,
		),
		assignees: data.assignees,
		labels: data.labels as PullRequestLabel[],
		mergeState: MERGE_STATES[data.mergeStateStatus.toUpperCase()] ?? "unknown",
		nodeId: enrichment.nodeId,
		viewer: enrichment.viewer,
		viewerCanUpdate: enrichment.viewerCanUpdate,
		viewerPermission: enrichment.viewerPermission,
		mergeMethods: enrichment.mergeMethods,
		reactions: enrichment.reactions,
		threads: enrichment.threads,
		avatars: enrichment.avatars,
		images: enrichment.images,
		headSha: enrichment.headSha,
		milestone: enrichment.milestone,
		linkedIssues: enrichment.linkedIssues,
		timeline: enrichment.timeline,
		enrichmentFailed: enrichment.failed,
	};
}

const PatchFileSchema = z.object({
	filename: z.string().min(1),
	previous_filename: z.string().min(1).nullable().catch(null),
	status: z.string().catch("modified"),
	patch: z.string().nullable().catch(null),
});

const PATCH_FILES_JQ = ".[] | {filename, previous_filename, status, patch: (.patch // null)}";

function isDiffTooLarge(error: unknown): boolean {
	if (isGitHubError(error) && error.github.reason === "too-large") return true;
	return (
		error instanceof Error &&
		/too_large|exceeded the maximum number of (lines|files)|HTTP 406/i.test(error.message)
	);
}

function fileHeader(file: z.infer<typeof PatchFileSchema>): string {
	const source = file.previous_filename ?? file.filename;
	const lines = [`diff --git a/${source} b/${file.filename}`];
	if (file.status === "added") {
		return [...lines, "new file mode 100644", "--- /dev/null", `+++ b/${file.filename}`].join("\n");
	}
	if (file.status === "removed") {
		return [...lines, "deleted file mode 100644", `--- a/${source}`, "+++ /dev/null"].join("\n");
	}
	const renamed = source === file.filename ? [] : [`rename from ${source}`, `rename to ${file.filename}`];
	return [...lines, ...renamed, `--- a/${source}`, `+++ b/${file.filename}`].join("\n");
}

function patchOfFiles(output: string): string {
	return linesOf(output, PatchFileSchema)
		.filter((file) => file.patch !== null)
		.map((file) => `${fileHeader(file)}\n${file.patch}\n`)
		.join("");
}

async function readPatch(
	cwd: string,
	url: string,
	address: { hostname: string; repository: string; number: number },
	run: GraphQLRun,
): Promise<string> {
	try {
		return await run(cwd, ["pr", "diff", url]);
	} catch (error) {
		if (!isDiffTooLarge(error)) throw error;
	}
	return patchOfFiles(
		await run(cwd, paginated(address, `pulls/${address.number}/files?per_page=100`, PATCH_FILES_JQ)),
	);
}

async function headOf(
	cwd: string,
	address: { hostname: string; repository: string; number: number },
	run: GraphQLRun,
): Promise<string> {
	const output = await run(cwd, [
		"api",
		"--hostname",
		address.hostname,
		`repos/${address.repository}/pulls/${address.number}`,
		"--jq",
		".head.sha",
	]);
	return output.trim();
}

export async function fetchPullRequestPatch(
	cwd: string,
	url: string,
	run: GraphQLRun,
	headSha?: string,
): Promise<PullRequestPatchResult> {
	const address = pullRequestAddress(url);
	if (!headSha) return { patch: await readPatch(cwd, url, address, run), headSha: "", stale: false };
	const [before, patch] = await Promise.all([headOf(cwd, address, run), readPatch(cwd, url, address, run)]);
	if (before !== headSha) return { patch: "", headSha: before, stale: true };
	const after = await headOf(cwd, address, run);
	if (after !== headSha) return { patch: "", headSha: after, stale: true };
	return { patch, headSha, stale: false };
}

export const MAX_BODY = 65536;
const MAX_NAMES = 50;
const Body = z.string().max(MAX_BODY);
const RequiredBody = Body.refine((value) => value.trim().length > 0, { message: "Write something first." });
const Title = z
	.string()
	.max(256)
	.refine((value) => value.trim().length > 0, { message: "Add a title." });
const DatabaseId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const NodeId = z.string().regex(/^[\w=-]{1,200}$/);
const LoginName = z.string().regex(/^@?[A-Za-z0-9_][\w.\-/]{0,99}$/);
const LabelName = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[^\p{Cc}]+$/u)
	.refine((name) => name.trim().length > 0);
const Reaction = z.enum(["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"]);
const CommentTarget = z.enum(["conversation", "review"]);
const Line = z.number().int().positive().max(1e7);
const Side = z.enum(["LEFT", "RIGHT"]);
const CommitId = z.string().regex(/^[0-9a-f]{40}$/);
const FilePath = z
	.string()
	.min(1)
	.max(1000)
	.refine((path) => !path.includes("\0") && !path.startsWith("/") && !path.split("/").includes(".."), {
		message: "That file path is not part of this pull request.",
	});
const MilestoneTitle = z
	.string()
	.max(256)
	.regex(/^[^\p{Cc}]*$/u)
	.refine((title) => title.trim().length > 0, { message: "Choose a milestone." });

function names<T extends z.ZodTypeAny>(name: T) {
	return z.object({ add: z.array(name).max(MAX_NAMES), remove: z.array(name).max(MAX_NAMES) });
}

export const PullRequestActionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("comment"), body: RequiredBody }),
	z.object({ kind: z.literal("reply"), commentId: DatabaseId, body: RequiredBody }),
	z.object({ kind: z.literal("edit-comment"), target: CommentTarget, commentId: DatabaseId, body: RequiredBody }),
	z.object({ kind: z.literal("delete-comment"), target: CommentTarget, commentId: DatabaseId }),
	z.object({ kind: z.literal("edit-description"), body: Body }),
	z.object({ kind: z.literal("edit-title"), title: Title }),
	z.object({ kind: z.literal("react"), subjectId: NodeId, content: Reaction, add: z.boolean() }),
	z
		.object({
			kind: z.literal("review"),
			event: z.enum(["approve", "request-changes", "comment"]),
			body: Body,
		})
		.refine((review) => review.event === "approve" || review.body.trim().length > 0, {
			message: "Write a review comment first.",
		}),
	z.object({ kind: z.literal("resolve-thread"), threadId: NodeId, resolved: z.boolean() }),
	names(LabelName).extend({ kind: z.literal("labels") }),
	names(LoginName).extend({ kind: z.literal("assignees") }),
	names(LoginName).extend({ kind: z.literal("reviewers") }),
	z.object({ kind: z.literal("state"), state: z.enum(["close", "reopen", "ready", "draft"]) }),
	z.object({ kind: z.literal("merge"), method: z.enum(["squash", "merge", "rebase"]), headSha: CommitId }),
	z
		.object({
			kind: z.literal("line-comment"),
			path: FilePath,
			line: Line,
			side: Side,
			startLine: Line.optional(),
			body: RequiredBody,
			commitId: CommitId.optional(),
		})
		.refine((comment) => comment.startLine === undefined || comment.startLine <= comment.line, {
			message: "A comment range must start before it ends.",
		}),
	z.object({ kind: z.literal("milestone"), title: MilestoneTitle.nullable() }),
	z.object({ kind: z.literal("update-branch"), rebase: z.boolean() }),
	z.object({
		kind: z.literal("rerun-checks"),
		urls: z.array(z.string().max(2048)).min(1).max(100),
		failedOnly: z.boolean(),
	}),
]);

export type ParsedPullRequestAction = z.infer<typeof PullRequestActionSchema>;

const REACTION_MUTATION = (name: string) =>
	`mutation($id: ID!, $content: ReactionContent!) { ${name}(input: {subjectId: $id, content: $content}) { reaction { content } } }`;
const THREAD_MUTATION = (name: string) =>
	`mutation($id: ID!) { ${name}(input: {threadId: $id}) { thread { id isResolved } } }`;

const HeadSchema = z.object({ headRefOid: z.string().regex(/^[0-9a-f]{40,64}$/) });
const MAX_RERUNS = 20;
const NOT_ACTIONS = "These checks are not GitHub Actions runs; re-run them from their provider.";

function invalidAction(message: string) {
	return githubError({ reason: "failed", message });
}

export function parsePullRequestAction(action: unknown): ParsedPullRequestAction {
	const parsed = PullRequestActionSchema.safeParse(action);
	if (parsed.success) return parsed.data;
	const issue = parsed.error.issues[0];
	const custom = issue?.code === "custom" ? issue.message : undefined;
	throw invalidAction(custom ?? "That pull request change is not valid.");
}

function field(name: string, value: string | number): string[] {
	return ["-f", `${name}=${value}`];
}

function typedField(name: string, value: string | number): string[] {
	return ["-F", `${name}=${value}`];
}

function api(
	address: { hostname: string; repository: string },
	method: string,
	path: string,
	fields: string[] = [],
): string[] {
	return ["api", "--hostname", address.hostname, "-X", method, `repos/${address.repository}/${path}`, ...fields];
}

function graphql(address: { hostname: string }, query: string, fields: string[]): string[] {
	return [
		"api",
		"graphql",
		"--hostname",
		address.hostname,
		"-f",
		`query=${query}`,
		...fields.flatMap((entry) => ["-f", entry]),
	];
}

function commentPath(target: "conversation" | "review", id: number): string {
	if (target === "conversation") return `issues/comments/${id}`;
	return `pulls/comments/${id}`;
}

const NAME_FLAGS: Record<string, string> = { assignees: "assignee", reviewers: "reviewer" };

function nameFlags(flag: string, add: string[], remove: string[]): string[] {
	return [
		...add.map((name) => `--add-${flag}=${name}`),
		...remove.map((name) => `--remove-${flag}=${name}`),
	];
}

function reviewFlag(event: "approve" | "request-changes" | "comment"): string {
	if (event === "approve") return "--approve";
	if (event === "request-changes") return "--request-changes";
	return "--comment";
}

function stateArgs(url: string, state: "close" | "reopen" | "ready" | "draft"): string[] {
	if (state === "draft") return ["pr", "ready", url, "--undo"];
	return ["pr", state, url];
}

const RUN_URL = /^https:\/\/([\w.-]+)\/([\w.-]+\/[\w.-]+)\/actions\/runs\/(\d{1,20})(?:\/job\/(\d{1,20}))?\/?(?:[?#].*)?$/;

function lineCommentArgs(
	address: { hostname: string; repository: string; number: number },
	action: Extract<ParsedPullRequestAction, { kind: "line-comment" }>,
	headSha: string,
): string[] {
	const range =
		action.startLine !== undefined && action.startLine < action.line
			? [...typedField("start_line", action.startLine), ...field("start_side", action.side)]
			: [];
	return api(address, "POST", `pulls/${address.number}/comments`, [
		...field("body", action.body),
		...field("commit_id", headSha),
		...field("path", action.path),
		...typedField("line", action.line),
		...field("side", action.side),
		...range,
	]);
}

type RerunTarget = { run: string; job?: string };

function rerunTargets(address: { hostname: string; repository: string }, urls: string[]): RerunTarget[] {
	return urls.flatMap((url) => {
		const match = RUN_URL.exec(url);
		if (!match?.[1] || !match[2] || !match[3]) return [];
		if (match[1] !== address.hostname) return [];
		if (match[2].toLowerCase() !== address.repository.toLowerCase()) return [];
		return [{ run: match[3], ...(match[4] ? { job: match[4] } : {}) }];
	});
}

function rerunSelector(target: RerunTarget, wholeRuns: Set<string>): string {
	if (!target.job || wholeRuns.has(target.run)) return target.run;
	return `--job=${target.job}`;
}

function rerunSelectors(address: { hostname: string; repository: string }, urls: string[], failedOnly: boolean): string[] {
	const targets = rerunTargets(address, urls);
	const wholeRuns = new Set(targets.filter((target) => failedOnly || !target.job).map((target) => target.run));
	const selectors = targets.map((target) => rerunSelector(target, wholeRuns));
	return [...new Set(selectors)].slice(0, MAX_RERUNS);
}

function rerunCommands(
	address: { hostname: string; repository: string },
	urls: string[],
	failedOnly: boolean,
): string[][] {
	return rerunSelectors(address, urls, failedOnly).map((selector) => [
		"run",
		"rerun",
		selector,
		"--repo",
		`${address.hostname}/${address.repository}`,
		...(failedOnly ? ["--failed"] : []),
	]);
}

function labelCommands(
	address: { hostname: string; repository: string; number: number },
	add: string[],
	remove: string[],
): string[][] {
	const labels = `issues/${address.number}/labels`;
	const adding =
		add.length === 0 ? [] : [api(address, "POST", labels, add.flatMap((name) => field("labels[]", name)))];
	const removing = remove.map((name) => api(address, "DELETE", `${labels}/${encodeURIComponent(name)}`));
	return [...adding, ...removing];
}

function pullRequestActionArgs(url: string, action: ParsedPullRequestAction): string[] | null {
	const address = pullRequestAddress(url);
	const number = address.number;
	if (action.kind === "comment") return api(address, "POST", `issues/${number}/comments`, field("body", action.body));
	if (action.kind === "reply")
		return api(address, "POST", `pulls/${number}/comments/${action.commentId}/replies`, field("body", action.body));
	if (action.kind === "edit-comment") {
		return api(address, "PATCH", commentPath(action.target, action.commentId), field("body", action.body));
	}
	if (action.kind === "delete-comment") return api(address, "DELETE", commentPath(action.target, action.commentId));
	if (action.kind === "edit-description") return api(address, "PATCH", `pulls/${number}`, field("body", action.body));
	if (action.kind === "edit-title") return ["pr", "edit", url, `--title=${action.title}`];
	if (action.kind === "react") {
		return graphql(address, REACTION_MUTATION(action.add ? "addReaction" : "removeReaction"), [
			`id=${action.subjectId}`,
			`content=${action.content}`,
		]);
	}
	if (action.kind === "review") {
		return ["pr", "review", url, reviewFlag(action.event), ...(action.body.trim() ? [`--body=${action.body}`] : [])];
	}
	if (action.kind === "resolve-thread") {
		return graphql(address, THREAD_MUTATION(action.resolved ? "resolveReviewThread" : "unresolveReviewThread"), [
			`id=${action.threadId}`,
		]);
	}
	if (action.kind === "state") return stateArgs(url, action.state);
	if (action.kind === "merge") {
		return ["pr", "merge", url, `--${action.method}`, `--match-head-commit=${action.headSha}`];
	}
	if (action.kind === "milestone") {
		return action.title === null
			? ["pr", "edit", url, "--remove-milestone"]
			: ["pr", "edit", url, `--milestone=${action.title}`];
	}
	if (action.kind === "update-branch") return ["pr", "update-branch", url, ...(action.rebase ? ["--rebase"] : [])];
	if (action.kind !== "assignees" && action.kind !== "reviewers") return null;
	const flags = nameFlags(NAME_FLAGS[action.kind], action.add, action.remove);
	if (flags.length === 0) return null;
	return ["pr", "edit", url, ...flags];
}

export function pullRequestActionCommands(
	url: string,
	action: ParsedPullRequestAction,
	context: { headSha: string },
): string[][] {
	const address = pullRequestAddress(url);
	if (action.kind === "line-comment") return [lineCommentArgs(address, action, action.commitId ?? context.headSha)];
	if (action.kind === "labels") return labelCommands(address, action.add, action.remove);
	if (action.kind === "rerun-checks") return rerunCommands(address, action.urls, action.failedOnly);
	const args = pullRequestActionArgs(url, action);
	return args ? [args] : [];
}

async function headShaOf(cwd: string, url: string, run: GraphQLRun): Promise<string> {
	const output = await run(cwd, ["pr", "view", url, "--json", "headRefOid"]);
	let json: unknown;
	try {
		json = JSON.parse(output);
	} catch {
		json = null;
	}
	const parsed = HeadSchema.safeParse(json);
	if (!parsed.success) {
		throw githubError({ reason: "invalid-response", message: "Could not read the pull request head commit." });
	}
	return parsed.data.headRefOid;
}

async function runEach(cwd: string, commands: string[][], run: GraphQLRun): Promise<void> {
	const failures: unknown[] = [];
	for (const args of commands) {
		try {
			await run(cwd, args);
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length === 0) return;
	const first = failures[0];
	if (commands.length === 1) throw first;
	const detail = first instanceof Error ? first.message : String(first);
	throw githubError({
		reason: isGitHubError(first) ? first.github.reason : "failed",
		message: `Could not re-run ${failures.length} of ${commands.length} checks: ${detail}`,
	});
}

export async function runPullRequestAction(cwd: string, url: string, action: unknown, run: GraphQLRun): Promise<void> {
	const parsed = parsePullRequestAction(action);
	pullRequestAddress(url);
	const headSha = parsed.kind === "line-comment" && !parsed.commitId ? await headShaOf(cwd, url, run) : "";
	const commands = pullRequestActionCommands(url, parsed, { headSha });
	if (parsed.kind === "rerun-checks" && commands.length === 0) throw invalidAction(NOT_ACTIONS);
	if (parsed.kind === "rerun-checks") {
		await runEach(cwd, commands, run);
		return;
	}
	for (const args of commands) await run(cwd, args);
}

export type { PullRequestSummary, PullRequestMergeMethod };
export { countOf };
