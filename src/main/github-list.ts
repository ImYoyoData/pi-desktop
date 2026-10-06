import { z } from "zod";
import type {
	PullRequestChoices,
	PullRequestFilters,
	PullRequestLabel,
	PullRequestListAuthor,
	PullRequestListState,
	PullRequestMilestone,
	PullRequestPage,
	PullRequestPerson,
} from "../shared/github-types";
import { githubError, isGitHubError, pullRequestsOfRecords, type PullRequestAddress } from "./github-core";
import type { GraphQLRun } from "./github-graphql";

const AVATAR_HOST = "avatars.githubusercontent.com";
const FALLBACK_COLOR = "8b949e";

const ROW_SELECTION = [
	"author { login avatarUrl }",
	"labels(first: 6) { nodes { name color } }",
	"comments { totalCount }",
	"assignees(first: 4) { nodes { login avatarUrl } }",
	"reviewRequests(first: 4) { nodes { requestedReviewer { __typename ... on User { login avatarUrl } ... on Bot { login avatarUrl } ... on Team { slug organization { login } } } } }",
].join("\n\t\t\t");

const Text = z.string().min(1);

function lenientNodes<T extends z.ZodTypeAny>(item: T) {
	return z.object({ nodes: z.array(z.unknown()) }).transform((connection) =>
		connection.nodes.flatMap((node) => {
			const parsed = item.safeParse(node);
			return parsed.success ? [parsed.data as z.infer<T>] : [];
		}),
	);
}

const PersonSchema = z.object({ login: Text, avatarUrl: z.unknown() });
const LabelSchema = z.object({ name: Text, color: z.unknown() });

const ReviewerSchema = z.object({
	requestedReviewer: z.union([
		z.object({ __typename: z.enum(["User", "Bot"]), login: Text, avatarUrl: z.unknown() }),
		z.object({
			__typename: z.literal("Team"),
			slug: Text,
			organization: z.object({ login: Text }),
		}),
	]),
});

const RowSchema = z.object({
	author: z.object({ avatarUrl: z.unknown() }).optional().catch(undefined),
	labels: lenientNodes(LabelSchema).optional().catch(undefined),
	comments: z.object({ totalCount: z.number().int().nonnegative() }).optional().catch(undefined),
	assignees: lenientNodes(PersonSchema).optional().catch(undefined),
	reviewRequests: lenientNodes(ReviewerSchema).optional().catch(undefined),
});

function avatarUrlOf(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.hostname !== AVATAR_HOST) return undefined;
	if (url.username || url.password || url.port) return undefined;
	return url.href;
}

function colorOf(value: unknown): string {
	return typeof value === "string" && /^[0-9a-fA-F]{6}$/.test(value) ? value : FALLBACK_COLOR;
}

function personOf(login: string, avatar: unknown): PullRequestPerson {
	const avatarUrl = avatarUrlOf(avatar);
	return avatarUrl ? { login, avatarUrl } : { login };
}

function reviewerOf(request: z.infer<typeof ReviewerSchema>): PullRequestPerson {
	const reviewer = request.requestedReviewer;
	if (reviewer.__typename === "Team") {
		return { login: `${reviewer.organization.login}/${reviewer.slug}` };
	}
	return personOf(reviewer.login, reviewer.avatarUrl);
}

export function rowExtrasOf(node: unknown): Partial<import("../shared/github-types").PullRequestSummary> {
	const parsed = RowSchema.safeParse(node);
	if (!parsed.success) return {};
	const row = parsed.data;
	const authorAvatarUrl = avatarUrlOf(row.author?.avatarUrl);
	const labels: PullRequestLabel[] | undefined = row.labels
		?.slice(0, 6)
		.map((label) => ({ name: label.name, color: colorOf(label.color) }));
	return {
		...(authorAvatarUrl ? { authorAvatarUrl } : {}),
		...(labels ? { labels } : {}),
		...(row.comments ? { commentCount: row.comments.totalCount } : {}),
		...(row.assignees ? { assignees: row.assignees.slice(0, 4).map((person) => personOf(person.login, person.avatarUrl)) } : {}),
		...(row.reviewRequests
			? { requestedReviewers: row.reviewRequests.slice(0, 4).map(reviewerOf) }
			: {}),
	};
}

const USER = /^(@me|[A-Za-z0-9][A-Za-z0-9_-]{0,38}(\[bot\])?)$/;
const TEAM = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^[\w./+@#-]{1,200}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUOTABLE = /^[^"\p{Cc}]{1,256}$/u;
const User = z.string().regex(USER);
const Branch = z
	.string()
	.regex(BRANCH)
	.refine((value) => !value.startsWith("-"));
const Day = z
	.string()
	.regex(DATE)
	.refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
const Quoted = z.string().regex(QUOTABLE);

const PullRequestFilterFields = {
	text: z.string().max(256),
	author: User,
	assignee: z.union([z.literal("none"), User]),
	mentions: User,
	involves: User,
	commenter: User,
	reviewRequested: z.union([User, z.string().regex(TEAM)]),
	reviewedBy: User,
	review: z.enum(["none", "required", "approved", "changes-requested"]),
	checks: z.enum(["success", "failure", "pending", "none"]),
	draft: z.boolean(),
	labels: z.array(Quoted.max(100)).max(20),
	noLabel: z.boolean(),
	milestone: Quoted,
	base: Branch,
	head: Branch,
	linked: z.literal("issue"),
	createdAfter: Day,
	updatedAfter: Day,
	sort: z.enum([
		"updated-desc",
		"updated-asc",
		"created-desc",
		"created-asc",
		"comments-desc",
		"comments-asc",
		"reactions-desc",
		"interactions-desc",
	]),
};

export const PullRequestFiltersSchema = z.object(PullRequestFilterFields).partial().strict();

const SCOPE_TOKEN = /^-?(repo|org|user|owner|is|type|in|state|sort):/i;
const OPERATOR_TOKEN = /^(OR|AND|NOT)$/;

const REVIEW_QUALIFIERS: Record<string, string> = {
	none: "review:none",
	required: "review:required",
	approved: "review:approved",
	"changes-requested": "review:changes_requested",
};

const SORT_QUALIFIERS: Record<string, string> = {
	"updated-desc": "sort:updated-desc",
	"updated-asc": "sort:updated-asc",
	"created-desc": "sort:created-desc",
	"created-asc": "sort:created-asc",
	"comments-desc": "sort:comments-desc",
	"comments-asc": "sort:comments-asc",
	"reactions-desc": "sort:reactions-desc",
	"interactions-desc": "sort:interactions-desc",
};

function lifecycleQualifier(state: PullRequestListState): string[] {
	if (state === "all") return [];
	if (state === "closed") return ["is:closed", "-is:merged"];
	return [`is:${state}`];
}

function searchText(text: string): string {
	const tokens = text
		.replace(new RegExp("\\p{Cc}", "gu"), " ")
		.replace(/[()]/g, " ")
		.split(/\s+/)
		.filter((token) => token && !SCOPE_TOKEN.test(token) && !OPERATOR_TOKEN.test(token));
	const joined = tokens.join(" ");
	const quotes = joined.split('"').length - 1;
	return quotes % 2 === 0 ? joined : joined.replaceAll('"', "");
}

function user(name: string, value: string | undefined): string[] {
	return value ? [`${name}:${value}`] : [];
}

function optionalQualifier(
	value: string | undefined,
	none: string,
	qualifier: (value: string) => string,
): string[] {
	if (!value) return [];
	if (value === "none") return [none];
	return [qualifier(value)];
}

function checksQualifier(checks: string | undefined): string[] {
	if (!checks || checks === "none") return [];
	return [`status:${checks}`];
}

function filterQualifiers(filters: PullRequestFilters): string[] {
	return [
		...optionalQualifier(filters.assignee, "no:assignee", (value) => `assignee:${value}`),
		...user("mentions", filters.mentions),
		...user("involves", filters.involves),
		...user("commenter", filters.commenter),
		...user("review-requested", filters.reviewRequested),
		...user("reviewed-by", filters.reviewedBy),
		...(filters.review ? [REVIEW_QUALIFIERS[filters.review]] : []),
		...checksQualifier(filters.checks),
		...(filters.draft === undefined ? [] : [`draft:${filters.draft}`]),
		...(filters.labels ?? []).map((label) => `label:"${label}"`),
		...(filters.noLabel ? ["no:label"] : []),
		...optionalQualifier(filters.milestone, "no:milestone", (value) => `milestone:"${value}"`),
		...user("base", filters.base),
		...user("head", filters.head),
		...(filters.linked ? [`linked:${filters.linked}`] : []),
		...(filters.createdAfter ? [`created:>=${filters.createdAfter}`] : []),
		...(filters.updatedAfter ? [`updated:>=${filters.updatedAfter}`] : []),
	];
}

type SearchScope = {
	repository: string;
	state: PullRequestListState;
	author: PullRequestListAuthor;
	filters: PullRequestFilters;
};

function scopedQualifiers(search: SearchScope): string[] {
	const filters = search.filters;
	const author = filters.author ?? (search.author === "mine" ? "@me" : undefined);
	const text = filters.text ? searchText(filters.text) : "";
	return [...user("author", author), ...filterQualifiers(filters), ...(text ? [text] : [])];
}

function pullRequestSearchQuery(search: SearchScope): string {
	const sort = search.filters.sort ?? "updated-desc";
	return [
		`repo:${search.repository}`,
		"is:pr",
		...lifecycleQualifier(search.state),
		...scopedQualifiers(search),
		SORT_QUALIFIERS[sort] ?? SORT_QUALIFIERS["updated-desc"],
	].join(" ");
}

function stateCountQueries(search: SearchScope): { open: string; closed: string; merged: string } {
	const base = [`repo:${search.repository}`, "is:pr", ...scopedQualifiers(search)];
	return {
		open: [...base, "is:open"].join(" "),
		closed: [...base, "is:closed", "-is:merged"].join(" "),
		merged: [...base, "is:merged"].join(" "),
	};
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export type TtlCache<T> = {
	get: (key: string) => T | undefined;
	remember: (key: string, value: T) => void;
	forget: (key: string) => void;
};

export function createTtlCache<T>(ttlMs = FIVE_MINUTES_MS): TtlCache<T> {
	const entries = new Map<string, { value: T; at: number }>();
	return {
		get: (key) => {
			const entry = entries.get(key);
			if (!entry) return undefined;
			if (Date.now() - entry.at <= ttlMs) return entry.value;
			entries.delete(key);
			return undefined;
		},
		remember: (key, value) => {
			entries.set(key, { value, at: Date.now() });
		},
		forget: (key) => {
			entries.delete(key);
		},
	};
}

export type RepositoryIdentity = { hostname: string; repository: string };

export const RepositorySchema = z.object({
	nameWithOwner: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
	url: z.url({ protocol: /^https$/ }),
});

const PageCommitSchema = z.object({
	statusCheckRollup: z
		.object({ state: z.enum(["EXPECTED", "ERROR", "FAILURE", "PENDING", "SUCCESS"]) })
		.nullable(),
});

const NodeSchema = z
	.object({
		commits: z
			.object({ nodes: z.array(z.object({ commit: PageCommitSchema })).max(1) })
			.optional()
			.catch(undefined),
	})
	.loose();

const PageSchema = z.object({
	errors: z.array(z.unknown()).max(0).optional(),
	data: z.object({
		search: z.object({
			issueCount: z.number().int().nonnegative(),
			pageInfo: z.object({
				hasNextPage: z.boolean(),
				endCursor: z.string().min(1).nullable(),
			}),
			nodes: z.array(z.unknown()).max(50),
		}),
	}),
});

const PAGE_QUERY = `query($search: String!, $after: String) {
	search(query: $search, type: ISSUE, first: 50, after: $after) {
		issueCount
		pageInfo { hasNextPage endCursor }
		nodes { ... on PullRequest {
			number title url state mergedAt updatedAt createdAt isDraft
			baseRefName headRefName additions deletions changedFiles reviewDecision
			${ROW_SELECTION}
			headRepository { name nameWithOwner }
			commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
		} }
	}
}`;

const COUNTS_QUERY =
	"query($open: String!, $closed: String!, $merged: String!) { open: search(query: $open, type: ISSUE, first: 0) { issueCount } closed: search(query: $closed, type: ISSUE, first: 0) { issueCount } merged: search(query: $merged, type: ISSUE, first: 0) { issueCount } }";

const Count = z.object({ issueCount: z.number().int().nonnegative() });
const CountsSchema = z.object({ data: z.object({ open: Count, closed: Count, merged: Count }) });

function invalidPage() {
	return githubError({ reason: "invalid-response", message: "GitHub returned an invalid pull request page." });
}

function jsonOf(output: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		throw invalidPage();
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidPage();
	return parsed as Record<string, unknown>;
}

async function repositoryIdentity(cwd: string, run: GraphQLRun): Promise<RepositoryIdentity> {
	const repository = RepositorySchema.safeParse(jsonOf(await run(cwd, ["repo", "view", "--json", "nameWithOwner,url"])));
	if (!repository.success) throw invalidPage();
	const parsedUrl = (() => {
		try {
			return new URL(repository.data.url);
		} catch {
			return null;
		}
	})();
	const hostname = parsedUrl?.hostname;
	if (!hostname) throw invalidPage();
	return { hostname, repository: repository.data.nameWithOwner };
}

async function stateCounts(
	cwd: string,
	hostname: string,
	queries: { open: string; closed: string; merged: string },
	run: GraphQLRun,
	onFailure: (error: unknown) => void,
) {
	try {
		const output = await run(cwd, [
			"api",
			"graphql",
			"--hostname",
			hostname,
			"-f",
			`query=${COUNTS_QUERY}`,
			"-f",
			`open=${queries.open}`,
			"-f",
			`closed=${queries.closed}`,
			"-f",
			`merged=${queries.merged}`,
		]);
		const parsed = CountsSchema.parse(JSON.parse(output));
		const { open, closed, merged } = parsed.data;
		return { open: open.issueCount, closed: closed.issueCount, merged: merged.issueCount };
	} catch (error) {
		onFailure(error);
		return undefined;
	}
}

export async function cachedRepositoryIdentity(
	cwd: string,
	run: GraphQLRun,
	repositories?: TtlCache<RepositoryIdentity>,
): Promise<RepositoryIdentity> {
	const cached = repositories?.get(cwd);
	if (cached) return cached;
	const identity = await repositoryIdentity(cwd, run);
	repositories?.remember(cwd, identity);
	return identity;
}

function isCancelled(error: unknown): boolean {
	return isGitHubError(error) && error.github.reason === "cancelled";
}

function recordOf(record: Record<string, unknown>): Record<string, unknown> {
	const commits = record.commits as { nodes?: { commit?: { statusCheckRollup?: { state?: string } | null } }[] } | undefined;
	const commit = commits?.nodes?.[0]?.commit;
	if (!commit) return record;
	const rollup = commit.statusCheckRollup;
	return {
		...record,
		statusCheckRollup: rollup ? [{ name: "Checks", state: rollup.state }] : [],
	};
}

function pullRequestsOfNodes(nodes: unknown[]): import("../shared/github-types").PullRequestSummary[] {
	return nodes.flatMap((node) => {
		const parsed = NodeSchema.safeParse(node);
		if (!parsed.success) return [];
		const [pullRequest] = pullRequestsOfRecords([recordOf(parsed.data as Record<string, unknown>)]);
		return pullRequest ? [{ ...pullRequest, ...rowExtrasOf(node) }] : [];
	});
}

function filtersOf(request: PullRequestPageRequestV2): PullRequestFilters {
	const filters = PullRequestFiltersSchema.safeParse(request.filters ?? {});
	if (!filters.success) {
		throw githubError({ reason: "failed", message: "Those pull request filters are not valid." });
	}
	return filters.data as PullRequestFilters;
}

export type PullRequestPageRequestV2 = {
	cwd: string;
	state: PullRequestListState;
	author: PullRequestListAuthor;
	cursor?: string;
	filters?: PullRequestFilters;
	run: GraphQLRun;
	repositories?: TtlCache<RepositoryIdentity>;
};

export async function fetchPullRequestPage(request: PullRequestPageRequestV2): Promise<PullRequestPage> {
	const filters = filtersOf(request);
	const identity = await cachedRepositoryIdentity(request.cwd, request.run, request.repositories);
	const forget = (error: unknown) => {
		if (!isCancelled(error)) request.repositories?.forget(request.cwd);
	};
	try {
		return await readPage(request, identity, filters, forget);
	} catch (error) {
		forget(error);
		throw error;
	}
}

async function readPage(
	request: PullRequestPageRequestV2,
	identity: RepositoryIdentity,
	filters: PullRequestFilters,
	forget: (error: unknown) => void,
): Promise<PullRequestPage> {
	const { cwd, cursor, run, state, author } = request;
	const { hostname, repository } = identity;
	const search: SearchScope = { repository, state, author, filters };
	const [output, counts] = await Promise.all([
		run(cwd, [
			"api",
			"graphql",
			"--hostname",
			hostname,
			"-f",
			`query=${PAGE_QUERY}`,
			"-f",
			`search=${pullRequestSearchQuery(search)}`,
			...(cursor ? ["-f", `after=${cursor}`] : []),
		]),
		cursor
			? Promise.resolve(undefined)
			: stateCounts(cwd, hostname, stateCountQueries(search), run, forget),
	]);
	const parsed = PageSchema.safeParse(jsonOf(output));
	if (!parsed.success) throw invalidPage();
	const page = parsed.data.data.search;
	const nextCursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
	if (page.pageInfo.hasNextPage && (!nextCursor || nextCursor === cursor || page.nodes.length === 0)) {
		throw invalidPage();
	}
	return {
		pullRequests: pullRequestsOfNodes(page.nodes),
		nextCursor,
		totalCount: page.issueCount,
		repository,
		...(counts ? { counts } : {}),
	};
}

const BRANCH_PAGE = 100;
const MAX_BRANCH_PAGES = 5;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}(\[bot\])?$/;

const LabelLine = z.object({
	name: z.string().min(1),
	color: z
		.string()
		.regex(/^[0-9a-fA-F]{6}$/)
		.catch("8b949e"),
});

const MilestoneLine = z.object({
	number: z.number().int().positive(),
	title: z.string().min(1),
	due_on: z.string().nullable().catch(null),
});

function labelsOf(output: string): PullRequestLabel[] {
	return parseLinesWith(LabelLine, output);
}

function milestonesOf(output: string): PullRequestMilestone[] {
	return parseLinesWith(MilestoneLine, output).map((milestone) => ({
		number: milestone.number,
		title: milestone.title,
		...(milestone.due_on ? { dueOn: milestone.due_on } : {}),
	}));
}

function parseLinesWith<T extends z.ZodTypeAny>(schema: T, output: string): z.infer<T>[] {
	return output.split("\n").flatMap((line) => {
		const trimmed = line.trim();
		if (!trimmed) return [];
		try {
			const parsed = schema.safeParse(JSON.parse(trimmed));
			return parsed.success ? [parsed.data as z.infer<T>] : [];
		} catch {
			return [];
		}
	});
}

function linesOf(output: string, valid: (line: string) => boolean): string[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && valid(line));
}

function paginated(repository: RepositoryIdentity, path: string, jq: string): string[] {
	return [
		"api",
		"--hostname",
		repository.hostname,
		"--paginate",
		`repos/${repository.repository}/${path}`,
		"--jq",
		jq,
	];
}

async function branchesOf(cwd: string, repository: RepositoryIdentity, run: GraphQLRun): Promise<string[]> {
	const names: string[] = [];
	for (let page = 1; page <= MAX_BRANCH_PAGES; page += 1) {
		const output = await run(cwd, [
			"api",
			"--hostname",
			repository.hostname,
			`repos/${repository.repository}/branches?per_page=${BRANCH_PAGE}&page=${page}`,
			"--jq",
			".[].name",
		]);
		const batch = linesOf(output, () => true);
		names.push(...batch);
		if (batch.length < BRANCH_PAGE) break;
	}
	return names;
}

function choicesKey(repository: RepositoryIdentity, kind: string): string {
	return `${repository.hostname}/${repository.repository.toLowerCase()}#${kind}`;
}

async function cachedChoices(
	cwd: string,
	repository: RepositoryIdentity,
	kind: string,
	run: GraphQLRun,
	cache?: TtlCache<PullRequestChoices>,
): Promise<PullRequestChoices> {
	const key = choicesKey(repository, kind);
	const cached = cache?.get(key);
	if (cached) return cached;
	try {
		const choices = await fetchChoices(cwd, repository, kind, run);
		cache?.remember(key, choices);
		return choices;
	} catch (error) {
		cache?.forget(key);
		throw error;
	}
}

async function fetchChoices(
	cwd: string,
	repository: RepositoryIdentity,
	kind: string,
	run: GraphQLRun,
): Promise<PullRequestChoices> {
	if (kind === "labels") {
		const output = await run(cwd, paginated(repository, "labels", ".[] | {name, color}"));
		return { labels: labelsOf(output) };
	}
	if (kind === "milestones") {
		const output = await run(cwd, paginated(repository, "milestones?state=open&per_page=100", ".[] | {number, title, due_on}"));
		return { milestones: milestonesOf(output) };
	}
	if (kind === "branches") {
		const [defaultBranch, branches] = await Promise.all([
			run(cwd, [
				"api",
				"--hostname",
				repository.hostname,
				`repos/${repository.repository}`,
				"--jq",
				".default_branch",
			]).then((output) => output.trim().split("\n")[0]?.trim() ?? ""),
			branchesOf(cwd, repository, run),
		]);
		if (!defaultBranch) return { branches };
		return { branches: [defaultBranch, ...branches.filter((branch) => branch !== defaultBranch)] };
	}
	const output = await run(cwd, paginated(repository, "assignees", ".[].login"));
	return { people: linesOf(output, (line) => LOGIN.test(line)) };
}

export function fetchPullRequestChoices(
	cwd: string,
	url: string,
	kind: string,
	run: GraphQLRun,
	caches: { choices?: TtlCache<PullRequestChoices> } = {},
) {
	const { hostname, repository } = pullRequestAddressFrom(url);
	return cachedChoices(cwd, { hostname, repository }, kind, run, caches.choices);
}

export async function fetchRepositoryChoices(
	cwd: string,
	kind: string,
	run: GraphQLRun,
	caches: { repositories?: TtlCache<RepositoryIdentity>; choices?: TtlCache<PullRequestChoices> } = {},
): Promise<PullRequestChoices> {
	const repository = await cachedRepositoryIdentity(cwd, run, caches.repositories);
	try {
		return await cachedChoices(cwd, repository, kind, run, caches.choices);
	} catch (error) {
		caches.repositories?.forget(cwd);
		throw error;
	}
}

function pullRequestAddressFrom(url: string): PullRequestAddress {
	const match = /^https:\/\/([\w.-]+)\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d{0,9})\/?$/.exec(url);
	if (!match?.[1] || !match[2] || !match[3]) {
		throw githubError({ reason: "failed", message: "Not a pull request link." });
	}
	return { hostname: match[1], repository: match[2], number: Number(match[3]) };
}
