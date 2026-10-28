import { exec } from "dugite";
import {
	CONVERSATION_COMMENTS_JQ,
	createGhRunner,
	DEFAULT_TIMEOUT_MS,
	filterUnifiedDiff,
	githubError,
	isGitHubError,
	LIST_TIMEOUT_MS,
	loadGitHubImage,
	parseArray,
	parsePullRequestComments,
	parsePullRequestView,
	PULL_REQUEST_FIELDS,
	pullRequestAddress,
	pullRequestsOfRecords,
	requireNumber,
	REVIEW_COMMENTS_JQ,
	type RunGh,
} from "./github-core";
import type { PullRequestAddress } from "./github-core";
import type {
	PullRequestChoices,
	PullRequestCounts,
	PullRequestDetail,
	PullRequestListAuthor,
	PullRequestListState,
	PullRequestPage,
	PullRequestPatchResult,
	PullRequestState,
	PullRequestSummary,
	PullRequestFilters,
} from "../shared/github-types";
import { fetchPullRequestDetail, fetchPullRequestPatch, runPullRequestAction } from "./github-detail";
import {
	cachedRepositoryIdentity,
	countsKeyPrefix,
	createTtlCache,
	fetchPullRequestChoices,
	fetchPullRequestCounts,
	fetchPullRequestPage,
	fetchRepositoryChoices,
	pageKeyPrefix,
	type LocalIdentity,
	type RepositoryIdentity,
} from "./github-list";
import {
	DETAIL_CACHE_TTL_MS,
	detailCacheOptions,
	PULL_REQUEST_PAGE_TTL_MS,
	pageCacheOptions,
} from "./github-cache";

const PULL_REQUEST_STACK_DEPTH = 2;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SKIP_BRANCHES = new Set(["main", "master"]);
const DEFAULT_LIST_LIMIT = 30;

const FOREIGN_PULL_REQUEST = {
	reason: "failed" as const,
	message: "That pull request is not in this project's repository.",
};

function isCrossRepository(record: unknown): boolean {
	if (!record || typeof record !== "object") return false;
	return (record as { isCrossRepository?: unknown }).isCrossRepository === true;
}

function isOwnBranchRecord(record: unknown, viewer: string): boolean {
	if (!isCrossRepository(record)) return true;
	const owner = (record as { headRepositoryOwner?: { login?: unknown } }).headRepositoryOwner?.login;
	return typeof owner === "string" && viewer !== "" && owner.toLowerCase() === viewer.toLowerCase();
}

function isProjectRepository(project: RepositoryIdentity, address: PullRequestAddress): boolean {
	return (
		project.hostname.toLowerCase() === address.hostname.toLowerCase() &&
		project.repository.toLowerCase() === address.repository.toLowerCase()
	);
}

export type GitHubTransport = {
	kind: string;
	pullRequestDetail: (cwd: string, url: string, fresh?: boolean) => Promise<PullRequestDetail>;
	pullRequestPatch: (cwd: string, url: string, headSha?: string) => Promise<PullRequestPatchResult>;
	pullRequestAction: (cwd: string, url: string, action: unknown) => Promise<void>;
	pullRequestChoices: (cwd: string, url: string, kind: string) => Promise<PullRequestChoices>;
	repositoryChoices: (cwd: string, kind: string) => Promise<PullRequestChoices>;
	pullRequestPage: (request: {
		cwd: string;
		state: PullRequestListState;
		author: PullRequestListAuthor;
		cursor?: string;
		filters?: PullRequestFilters;
		signal?: AbortSignal;
		fresh?: boolean;
	}) => Promise<PullRequestPage>;
	pullRequestCounts: (request: {
		cwd: string;
		state: PullRequestListState;
		author: PullRequestListAuthor;
		filters?: PullRequestFilters;
		signal?: AbortSignal;
		fresh?: boolean;
	}) => Promise<PullRequestCounts | undefined>;
	pullRequestForBranch: (cwd: string, branch: string) => Promise<PullRequestSummary | null>;
	pullRequestByUrl: (cwd: string, url: string) => Promise<PullRequestSummary>;
	listPullRequests: (
		cwd: string,
		limit: number,
		state?: PullRequestListState,
		author?: PullRequestListAuthor,
	) => Promise<PullRequestSummary[]>;
	pullRequestComments: (cwd: string, number: number) => Promise<ReturnType<typeof parsePullRequestComments>>;
	pullRequestDiff: (cwd: string, number: number, paths?: string[]) => Promise<string>;
};

export type GitHubTransportOptions = {
	timeoutMs?: number;
	run?: RunGh;
};

const REMOTE_URL_PATTERN =
	/^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)(?::\d+)?[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

function identityFromRemote(url: string): RepositoryIdentity | null {
	const match = REMOTE_URL_PATTERN.exec(url.trim());
	if (!match?.[1] || !match[2] || !match[3]) return null;
	// ssh alias（常见为无点主机名）交给 gh repo view 解析，避免把别名当 GitHub 主机
	if (!match[1].includes(".")) return null;
	return { hostname: match[1], repository: `${match[2]}/${match[3]}` };
}

/** 用本地 git remote 解析仓库，省掉一次 gh 进程；失败由调用方回退 gh repo view。 */
const localIdentity: LocalIdentity = async (cwd) => {
	try {
		const result = await exec(["remote", "get-url", "origin"], cwd, {
			maxBuffer: 64 * 1024,
			signal: AbortSignal.timeout(5000),
		});
		if (result.exitCode !== 0) return null;
		return identityFromRemote(String(result.stdout));
	} catch {
		return null;
	}
};

export function createGhCliTransport(options: GitHubTransportOptions = {}): GitHubTransport {
	const { gh, slow } = createGhRunner({ timeoutMs: options.timeoutMs, run: options.run as never });
	const listTimeout = options.timeoutMs ?? LIST_TIMEOUT_MS;
	const repositories = createTtlCache<RepositoryIdentity>();
	const choices = createTtlCache<PullRequestChoices>();
	const pages = createTtlCache<PullRequestPage>(PULL_REQUEST_PAGE_TTL_MS, pageCacheOptions());
	const counts = createTtlCache<PullRequestCounts>();
	const details = createTtlCache<PullRequestDetail>(DETAIL_CACHE_TTL_MS, detailCacheOptions());
	const patches = createTtlCache<PullRequestPatchResult>(DETAIL_CACHE_TTL_MS, { limit: 4 });

	const inProject = async (cwd: string, url: string): Promise<RepositoryIdentity> => {
		const address = pullRequestAddress(url);
		const project = await cachedRepositoryIdentity(cwd, slow, repositories, localIdentity);
		if (isProjectRepository(project, address)) return project;
		repositories.forget(cwd);
		throw githubError(FOREIGN_PULL_REQUEST);
	};

	const viewers = new Map<string, Promise<string>>();
	const viewerLogin = (cwd: string): Promise<string> => {
		const cached = viewers.get(cwd);
		if (cached) return cached;
		const pending = gh(cwd, ["api", "user", "--jq", ".login"])
			.then((output) => output.trim())
			.catch(() => {
				viewers.delete(cwd);
				return "";
			});
		viewers.set(cwd, pending);
		return pending;
	};


	return {
		kind: "gh-cli",
		pullRequestDetail: async (cwd, url, fresh) => {
			await inProject(cwd, url);
			if (fresh) details.forget(url);
			const hit = details.get(url);
			if (hit) return hit;
			const stale = details.entry(url);
			if (stale) return { ...stale.value, stale: true };
			return details.run(url, () => fetchPullRequestDetail(cwd, url, slow));
		},
		pullRequestPatch: async (cwd, url, headSha) => {
			await inProject(cwd, url);
			if (!headSha) return fetchPullRequestPatch(cwd, url, slow, headSha);
			const key = `${url}|${headSha}`;
			const result = await patches.run(key, () => fetchPullRequestPatch(cwd, url, slow, headSha));
			if (result.stale) patches.forget(key);
			return result;
		},
		pullRequestAction: async (cwd, url, action) => {
			const project = await inProject(cwd, url);
			try {
				await runPullRequestAction(cwd, url, action, slow);
			} finally {
				details.forget(url);
				patches.forgetPrefix(url);
				pages.forgetPrefix(pageKeyPrefix(project));
				counts.forgetPrefix(countsKeyPrefix(project));
			}
		},
		pullRequestChoices: async (cwd, url, kind) => {
			await inProject(cwd, url);
			return fetchPullRequestChoices(cwd, url, kind, slow, { choices });
		},
		repositoryChoices: (cwd, kind) => fetchRepositoryChoices(cwd, kind, slow, { repositories, choices, local: localIdentity }),
		pullRequestPage: (request) =>
			fetchPullRequestPage({
				cwd: request.cwd,
				state: request.state,
				author: request.author,
				cursor: request.cursor,
				filters: request.filters,
				repositories,
				pages,
				local: localIdentity,
				fresh: request.fresh,
				run: (cwd, args) => gh(cwd, args, listTimeout, request.signal),
			}),
			pullRequestCounts: (request) =>
				fetchPullRequestCounts({
					cwd: request.cwd,
					state: request.state,
					author: request.author,
					filters: request.filters,
					repositories,
					counts,
					local: localIdentity,
					fresh: request.fresh,
					run: (cwd, args) => gh(cwd, args, listTimeout, request.signal),
				}),
		pullRequestForBranch: async (cwd, branch) => {
			const stdout = await gh(cwd, [
				"pr",
				"list",
				"--head",
				branch,
				"--state",
				"all",
				"--limit",
				"20",
				"--json",
				[...PULL_REQUEST_FIELDS, "isCrossRepository", "headRepositoryOwner"].join(","),
			]);
			const all = parseArray(stdout);
			const viewer = all.some(isCrossRepository) ? await viewerLogin(cwd) : "";
			const records = all.filter((record) => isOwnBranchRecord(record, viewer));
			const pullRequests = pullRequestsOfRecords(records);
			const pullRequest = pullRequests.find((entry) => entry.state === "open") ?? pullRequests[0];
			if (pullRequest) return pullRequest;
			if (records.length === 0) return null;
			throw githubError({ reason: "invalid-response", message: "GitHub returned an invalid pull request response." });
		},
		pullRequestByUrl: async (cwd, url) => {
			const stdout = await gh(cwd, ["pr", "view", url, "--json", PULL_REQUEST_FIELDS.join(",")]);
			const pullRequest = parsePullRequestView(stdout);
			if (!pullRequest) {
				throw githubError({ reason: "invalid-response", message: "GitHub returned an invalid pull request response." });
			}
			return pullRequest;
		},
		listPullRequests: async (cwd, limit, state = "open", author = "all") => {
			const stdout = await gh(
				cwd,
				[
					"pr",
					"list",
					"--state",
					state,
					...(author === "mine" ? ["--author", "@me"] : []),
					"--search",
					state === "closed" ? "sort:updated-desc -is:merged" : "sort:updated-desc",
					"--limit",
					String(Math.max(1, Math.trunc(limit))),
					"--json",
					PULL_REQUEST_FIELDS.join(","),
				],
				listTimeout,
			);
			const records = parseArray(stdout);
			const pullRequests = pullRequestsOfRecords(records);
			if (pullRequests.length !== records.length) {
				throw githubError({ reason: "invalid-response", message: "GitHub returned an invalid pull request list." });
			}
			return pullRequests;
		},
		pullRequestComments: async (cwd, number) => {
			const parsedNumber = requireNumber(number);
			const [conversation, review] = await Promise.all([
				gh(cwd, [
					"api",
					"--paginate",
					`/repos/{owner}/{repo}/issues/${parsedNumber}/comments?per_page=100`,
					"--jq",
					CONVERSATION_COMMENTS_JQ,
				]),
				gh(cwd, [
					"api",
					"--paginate",
					`/repos/{owner}/{repo}/pulls/${parsedNumber}/comments?per_page=100`,
					"--jq",
					REVIEW_COMMENTS_JQ,
				]),
			]);
			return [
				...parsePullRequestComments(conversation, "conversation"),
				...parsePullRequestComments(review, "review"),
			].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
		},
		pullRequestDiff: async (cwd, number, paths) => {
			const parsedNumber = requireNumber(number);
			const patch = await gh(cwd, ["pr", "diff", String(parsedNumber)]);
			return filterUnifiedDiff(patch, (paths ?? []).filter((entry) => entry.trim()));
		},
	};
}

export type GitHubClient = {
	kind: string;
	pullRequestForBranch: (cwd: string, branch: string) => Promise<PullRequestSummary | null>;
	cachedPullRequestForBranch: (cwd: string, branch: string) => PullRequestSummary | null;
	pullRequestByUrl: (cwd: string, url: string) => Promise<PullRequestSummary>;
	invalidate: (cwd?: string) => void;
	listPullRequests: (
		cwd: string,
		state: PullRequestListState,
		author: PullRequestListAuthor,
		cursor?: string,
		filters?: PullRequestFilters,
		signal?: AbortSignal,
		fresh?: boolean,
	) => Promise<PullRequestPage>;
	pullRequestCounts: (request: {
		cwd: string;
		state: PullRequestListState;
		author: PullRequestListAuthor;
		filters?: PullRequestFilters;
		signal?: AbortSignal;
		fresh?: boolean;
	}) => Promise<PullRequestCounts | undefined>;
	pullRequestDetail: (cwd: string, url: string, fresh?: boolean) => Promise<PullRequestDetail>;
	pullRequestPatch: (cwd: string, url: string, headSha?: string) => Promise<PullRequestPatchResult>;
	pullRequestAction: (cwd: string, url: string, action: unknown) => Promise<void>;
	pullRequestChoices: (cwd: string, url: string, kind: string) => Promise<PullRequestChoices>;
	repositoryChoices: (cwd: string, kind: string) => Promise<PullRequestChoices>;
	openPullRequests: (cwd: string, limit?: number) => Promise<PullRequestSummary[]>;
	pullRequestComments: (cwd: string, number: number) => Promise<ReturnType<typeof parsePullRequestComments>>;
	pullRequestDiff: (cwd: string, number: number, paths?: string[]) => Promise<string>;
};

export function createGitHubClient(
	transport: GitHubTransport,
	options: { now?: () => number; cacheTtlMs?: number; skipBranches?: Set<string> } = {},
): GitHubClient {
	const now = options.now ?? (() => Date.now());
	const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const skipBranches = options.skipBranches ?? DEFAULT_SKIP_BRANCHES;
	const cache = new Map<string, Map<string, { result: PullRequestSummary | null; timestamp: number }>>();
	let generation = 0;

	const remembered = (cwd: string, branch: string): PullRequestSummary | null | undefined => {
		const byBranch = cache.get(cwd);
		const entry = byBranch?.get(branch);
		if (!byBranch || !entry) return undefined;
		if (now() - entry.timestamp > cacheTtlMs) {
			byBranch.delete(branch);
			return undefined;
		}
		return entry.result;
	};

	const remember = (cwd: string, branch: string, result: PullRequestSummary | null): void => {
		const byBranch = cache.get(cwd) ?? new Map();
		byBranch.set(branch, { result, timestamp: now() });
		cache.set(cwd, byBranch);
	};

	const chainParent = async (
		cwd: string,
		pullRequest: PullRequestSummary,
		base: string | undefined,
		depth: number,
	): Promise<PullRequestSummary> => {
		if (!base || depth >= PULL_REQUEST_STACK_DEPTH) return pullRequest;
		const parent = await forBranch(cwd, base, depth + 1).catch(() => null);
		return parent ? { ...pullRequest, parent } : pullRequest;
	};

	const fetchAndRemember = async (cwd: string, branch: string): Promise<PullRequestSummary | null> => {
		const startedAt = generation;
		const pullRequest = await transport.pullRequestForBranch(cwd, branch);
		if (generation !== startedAt) return pullRequest;
		remember(cwd, branch, pullRequest);
		return pullRequest;
	};

	const chainFromCache = (
		cwd: string,
		branch: string,
		pullRequest: PullRequestSummary | null,
		depth: number,
	): PullRequestSummary | null => {
		if (!pullRequest) return null;
		const base = pullRequest.baseBranch;
		if (!base || base === branch || depth >= PULL_REQUEST_STACK_DEPTH) return pullRequest;
		const parent = remembered(cwd, base);
		if (!parent) return pullRequest;
		return { ...pullRequest, parent: chainFromCache(cwd, base, parent, depth + 1) ?? undefined };
	};

	async function forBranch(cwd: string, branch: string, depth: number): Promise<PullRequestSummary | null> {
		if (!branch || branch === "HEAD" || branch.startsWith("-")) return null;
		if (skipBranches.has(branch)) return null;
		const cached = remembered(cwd, branch);
		const pullRequest = cached === undefined ? await fetchAndRemember(cwd, branch) : cached;
		if (!pullRequest) return null;
		const base = pullRequest.baseBranch;
		return chainParent(cwd, pullRequest, base === branch ? undefined : base, depth);
	}

	return {
		kind: transport.kind,
		pullRequestForBranch: (cwd, branch) => forBranch(cwd, branch, 0),
		cachedPullRequestForBranch: (cwd, branch) => {
			const cached = remembered(cwd, branch);
			return cached ? chainFromCache(cwd, branch, cached, 0) : null;
		},
		pullRequestByUrl: async (cwd, url) => {
			const pullRequest = await transport.pullRequestByUrl(cwd, url);
			const base = pullRequest.baseBranch;
			return chainParent(cwd, pullRequest, base === pullRequest.headBranch ? undefined : base, 0);
		},
		invalidate: (cwd) => {
			generation += 1;
			if (cwd === undefined) {
				cache.clear();
				return;
			}
			cache.delete(cwd);
		},
		listPullRequests: (cwd, state, author, cursor, filters, signal, fresh) =>
			transport.pullRequestPage({ cwd, state, author, cursor, filters, signal, fresh }),
		pullRequestCounts: (request) => transport.pullRequestCounts(request),
		pullRequestDetail: (cwd, url, fresh) => transport.pullRequestDetail(cwd, url, fresh),
		pullRequestPatch: (cwd, url, headSha) => transport.pullRequestPatch(cwd, url, headSha),
		pullRequestAction: (cwd, url, action) => transport.pullRequestAction(cwd, url, action),
		pullRequestChoices: (cwd, url, kind) => transport.pullRequestChoices(cwd, url, kind),
		repositoryChoices: (cwd, kind) => transport.repositoryChoices(cwd, kind),
		openPullRequests: (cwd, limit) =>
			transport.listPullRequests(
				cwd,
				typeof limit === "number" && Number.isFinite(limit) ? limit : DEFAULT_LIST_LIMIT,
				"open",
				"all",
			),
		pullRequestComments: (cwd, number) => transport.pullRequestComments(cwd, number),
		pullRequestDiff: (cwd, number, paths) => transport.pullRequestDiff(cwd, number, paths),
	};
}

export const githubClient = createGitHubClient(createGhCliTransport());

export type { PullRequestState };
export { isGitHubError, loadGitHubImage, DEFAULT_TIMEOUT_MS };
