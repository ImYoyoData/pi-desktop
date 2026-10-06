import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type {
	GitHubFailureReason,
	GitHubImageResult,
	PullRequestCheck,
	PullRequestCheckState,
	PullRequestComment,
	PullRequestCommentKind,
	PullRequestReviewDecision,
	PullRequestState,
	PullRequestSummary,
} from "../shared/github-types";
import { augmentPathForPiCli } from "./pi-path-env";
import { netFetch } from "./net-fetch";

export type GitHubFailure = { reason: GitHubFailureReason; message: string };

export class GitHubError extends Error {
	readonly github: GitHubFailure;

	constructor(failure: GitHubFailure) {
		super(failure.message);
		this.name = "GitHubError";
		this.github = failure;
	}
}

export function githubError(failure: GitHubFailure): GitHubError {
	return new GitHubError(failure);
}

export function isGitHubError(error: unknown): error is GitHubError {
	return error instanceof GitHubError;
}

export const DEFAULT_TIMEOUT_MS = 5000;
export const LIST_TIMEOUT_MS = 20000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const RETRY_DELAY_MS = 800;

export const CANCELLED: GitHubFailure = { reason: "cancelled", message: "Cancelled." };
const WRITE_TIMED_OUT: GitHubFailure = {
	reason: "timed-out",
	message: "GitHub took too long to answer. The change may still have gone through — refresh to check.",
};
const WRITE_UNAVAILABLE: GitHubFailure = {
	reason: "unavailable",
	message: "GitHub had trouble answering. The change may still have gone through — refresh to check.",
};

export const WRITE_TIMED_OUT_MESSAGE = WRITE_TIMED_OUT.message;
export const WRITE_UNAVAILABLE_MESSAGE = WRITE_UNAVAILABLE.message;

const execFileAsync = promisify(execFile);
export type RunGh = (cwd: string, args: string[], timeoutMs?: number) => Promise<string>;

export function ghEnv(): NodeJS.ProcessEnv {
	return {
		...augmentPathForPiCli(process.env),
		GH_PROMPT_DISABLED: "1",
		GH_PAGER: "",
		GH_NO_UPDATE_NOTIFIER: "1",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
	};
}

const ApiErrorSchema = z.object({
	message: z.string().catch(""),
	errors: z
		.array(
			z.union([
				z.string(),
				z.object({
					message: z.string().optional().catch(undefined),
					code: z.string().optional().catch(undefined),
					field: z.string().optional().catch(undefined),
				}),
			]),
		)
		.catch([]),
});

function apiErrorPart(entry: unknown): string {
	if (typeof entry === "string") return entry;
	if (!entry || typeof entry !== "object") return "";
	const record = entry as { message?: unknown; code?: unknown; field?: unknown };
	if (typeof record.message === "string" && record.message) return record.message;
	return [record.code, record.field].filter((part): part is string => typeof part === "string").join(" ");
}

function apiErrorDetail(stdout: string, stderr: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return "";
	}
	const body = ApiErrorSchema.safeParse(parsed);
	if (!body.success) return "";
	const parts = body.data.errors.map(apiErrorPart);
	const reasons = parts.length > 0 ? parts : [body.data.message];
	return [...new Set(reasons)].filter((reason) => reason && !stderr.includes(reason)).join("; ");
}

type ExecFailure = {
	name?: string;
	code?: string;
	killed?: boolean;
	signal?: string;
	stdout?: string;
	stderr?: string;
	message?: string;
};

export function classify(error: unknown): GitHubFailure {
	const failure = (error ?? {}) as ExecFailure;
	const stderr = (failure.stderr ?? "").trim();
	if (failure.name === "AbortError" || failure.code === "ABORT_ERR") return CANCELLED;
	if (failure.code === "ENOENT") {
		return { reason: "not-installed", message: "GitHub CLI not found. Install gh to see pull requests." };
	}
	if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
		return { reason: "too-large", message: "That pull request is too large to load here." };
	}
	if (failure.killed || failure.signal === "SIGTERM") {
		return { reason: "timed-out", message: "GitHub took too long to answer." };
	}
	if (/no git remotes found|none of the git remotes configured for this repository point to a known GitHub host/i.test(stderr)) {
		return {
			reason: "not-github",
			message: "This project has no GitHub remote. Pull requests need a repository hosted on GitHub.",
		};
	}
	if (/not a git repository/i.test(stderr)) {
		return { reason: "not-github", message: "This project is not a git repository." };
	}
	if (/HTTP 50[0234]\b|\b50[234] (Bad Gateway|Service Unavailable|Gateway Timeout)/i.test(stderr)) {
		return { reason: "unavailable", message: "GitHub is having trouble right now. Try again in a moment." };
	}
	if (/HTTP 401\b|bad credentials|not logged in|gh auth login|authentication required|requires authentication/i.test(stderr)) {
		return { reason: "not-authenticated", message: "Not signed in to GitHub. Run `gh auth login`." };
	}
	const message = stderr || failure.message || "GitHub request failed.";
	const detail = apiErrorDetail((failure.stdout ?? "").trim(), message);
	return { reason: "failed", message: detail ? `${message}: ${detail}` : message };
}

function isRead(args: string[]): boolean {
	if (args[0] === "api") {
		const method = args.find((arg) => /^(GET|POST|PATCH|PUT|DELETE)$/.test(arg));
		const mutation = args.some((arg) => /^query=\s*mutation\b/.test(arg));
		return (!method || method === "GET") && !mutation;
	}
	return ["view", "list", "diff", "status", "checks"].includes(args[1] ?? "");
}

export type GhRunnerOptions = {
	timeoutMs?: number;
	run?: (cwd: string, args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<{ stdout: string }>;
};

export function createGhRunner(options: GhRunnerOptions = {}) {
	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const run =
		options.run ??
		((cwd: string, args: string[], timeoutMs: number, signal?: AbortSignal) =>
			execFileAsync("gh", args, {
				cwd,
				env: ghEnv(),
				timeout: timeoutMs,
				maxBuffer: MAX_OUTPUT_BYTES,
				...(signal ? { signal } : {}),
			}).then((result) => ({ stdout: String(result.stdout) })));

	const gh = async (
		cwd: string,
		args: string[],
		timeoutMs: number = timeout,
		signal?: AbortSignal,
	): Promise<string> => {
		const failureOf = (error: unknown): GitHubFailure => {
			if (signal?.aborted) return CANCELLED;
			const failure = classify(error);
			if (isRead(args)) return failure;
			if (failure.reason === "timed-out") return WRITE_TIMED_OUT;
			if (failure.reason === "unavailable") return WRITE_UNAVAILABLE;
			return failure;
		};
		if (signal?.aborted) throw githubError(CANCELLED);
		let firstFailure: GitHubFailure;
		try {
			const { stdout } = await run(cwd, args, timeoutMs, signal);
			return stdout;
		} catch (error) {
			firstFailure = failureOf(error);
			if (firstFailure.reason !== "unavailable" || !isRead(args)) throw githubError(firstFailure);
		}
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		if (signal?.aborted) throw githubError(CANCELLED);
		try {
			const { stdout } = await run(cwd, args, timeoutMs, signal);
			return stdout;
		} catch (error) {
			throw githubError(failureOf(error));
		}
	};

	return { gh, timeout, slow: (cwd: string, args: string[]) => gh(cwd, args, LIST_TIMEOUT_MS) };
}

export const PULL_REQUEST_FIELDS = [
	"number",
	"title",
	"url",
	"state",
	"mergedAt",
	"updatedAt",
	"isDraft",
	"baseRefName",
	"headRefName",
	"additions",
	"deletions",
	"headRepository",
	"statusCheckRollup",
	"reviewDecision",
	"author",
	"changedFiles",
	"createdAt",
];

const FAILED_CONCLUSIONS = new Set([
	"FAILURE",
	"TIMED_OUT",
	"CANCELLED",
	"ACTION_REQUIRED",
	"STARTUP_FAILURE",
	"STALE",
	"ERROR",
]);

const PENDING_STATUSES = new Set(["QUEUED", "IN_PROGRESS", "PENDING", "WAITING", "REQUESTED", "EXPECTED"]);

function checkStateOf(record: Record<string, unknown>): PullRequestCheckState {
	const conclusion = String(record.conclusion ?? "").toUpperCase();
	if (conclusion === "SUCCESS") return "success";
	if (FAILED_CONCLUSIONS.has(conclusion)) return "failure";
	if (conclusion === "NEUTRAL" || conclusion === "SKIPPED") return "none";
	const status = String(record.status ?? record.state ?? "").toUpperCase();
	if (status === "SUCCESS") return "success";
	if (FAILED_CONCLUSIONS.has(status)) return "failure";
	if (PENDING_STATUSES.has(status)) return "pending";
	return "none";
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value) return value;
	}
	return undefined;
}

export function parseStatusCheckRollup(value: unknown): PullRequestCheck[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const record = entry as Record<string, unknown>;
		const name = firstString(record, ["name", "context"]);
		if (!name) return [];
		const url = firstString(record, ["detailsUrl", "targetUrl"]);
		return [{ name, state: checkStateOf(record), ...(url ? { url } : {}) }];
	});
}

const REVIEW_DECISIONS: Record<string, PullRequestReviewDecision> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	REVIEW_REQUIRED: "review-required",
};

function reviewDecisionOf(value: unknown): PullRequestReviewDecision | undefined {
	return typeof value === "string" ? REVIEW_DECISIONS[value.toUpperCase()] : undefined;
}

export function stringFieldOf(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field ? field : undefined;
}

export function isoOf(value: unknown): string | undefined {
	return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function repoNameOf(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const name = (value as Record<string, unknown>).name;
	return typeof name === "string" && name ? name : undefined;
}

export function countOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function branchOf(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

export function pullRequestsOfRecords(records: unknown[]): PullRequestSummary[] {
	return records
		.filter((entry): entry is Record<string, unknown> => {
			if (!entry || typeof entry !== "object") return false;
			const record = entry as Record<string, unknown>;
			return (
				typeof record.number === "number" &&
				Number.isSafeInteger(record.number) &&
				record.number > 0 &&
				typeof record.title === "string" &&
				typeof record.url === "string"
			);
		})
		.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
		.flatMap((record) => {
			const rawState = String(record.state ?? "").toLowerCase();
			const state: PullRequestState | null = record.mergedAt
				? "merged"
				: rawState === "open" || rawState === "merged" || rawState === "closed"
					? rawState
					: null;
			if (!state) return [];
			const repo = repoNameOf(record.headRepository);
			const headBranch = branchOf(record.headRefName);
			const baseBranch = branchOf(record.baseRefName);
			const additions = countOf(record.additions);
			const deletions = countOf(record.deletions);
			const repoFullName = stringFieldOf(record.headRepository, "nameWithOwner");
			const author = stringFieldOf(record.author, "login");
			const changedFiles = countOf(record.changedFiles);
			const createdAt = isoOf(record.createdAt);
			const updatedAt = isoOf(record.updatedAt);
			const reviewDecision = reviewDecisionOf(record.reviewDecision);
			return [
				{
					number: record.number as number,
					title: record.title as string,
					url: record.url as string,
					state,
					...(typeof record.isDraft === "boolean" ? { isDraft: record.isDraft } : {}),
					...(repo ? { repo } : {}),
					...(headBranch ? { headBranch } : {}),
					...(baseBranch ? { baseBranch } : {}),
					...(additions !== undefined ? { additions } : {}),
					...(deletions !== undefined ? { deletions } : {}),
					...(repoFullName ? { repoFullName } : {}),
					...(author ? { author } : {}),
					...(createdAt ? { createdAt } : {}),
					...(updatedAt ? { updatedAt } : {}),
					...(changedFiles !== undefined ? { changedFiles } : {}),
					...(reviewDecision ? { reviewDecision } : {}),
					...(Array.isArray(record.statusCheckRollup)
						? { checks: parseStatusCheckRollup(record.statusCheckRollup) }
						: {}),
				},
			];
		});
}

export function pullRequestOfRecords(records: unknown[]): PullRequestSummary | null {
	return pullRequestsOfRecords(records)[0] ?? null;
}

export function parsePullRequestView(output: string): PullRequestSummary | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	return pullRequestOfRecords([parsed]);
}

export function parseArray(stdout: string): unknown[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw githubError({ reason: "invalid-response", message: "GitHub returned an unreadable response." });
	}
	if (!Array.isArray(parsed)) {
		throw githubError({ reason: "invalid-response", message: "GitHub returned an invalid pull request response." });
	}
	return parsed;
}

const USER_JQ = 'user: (.user | if type == "object" then {login} else null end)';

const HUNK_TAIL_JQ = String.raw`def old_lines: map(select((startswith("+") or startswith("\\")) | not)) | length;
def new_lines: map(select((startswith("-") or startswith("\\")) | not)) | length;
def hunk_tail($keep):
	split("\n") as $lines
	| ($lines | length) as $count
	| if $count <= $keep + 1 then .
	else (
		($lines[0] | capture("^@@ -(?<old>[0-9]+)(,[0-9]+)? \\+(?<new>[0-9]+)(,[0-9]+)? @@(?<rest>.*)$")) as $head
		| $lines[1:$count - $keep] as $dropped
		| $lines[$count - $keep:] as $kept
		| ["@@ -\(($head.old | tonumber) + ($dropped | old_lines)),\($kept | old_lines) +\(($head.new | tonumber) + ($dropped | new_lines)),\($kept | new_lines) @@\($head.rest)"] + $kept
		| join("\n")
	) // ($lines[$count - $keep:] | join("\n"))
	end;`;

export const CONVERSATION_COMMENTS_JQ = `.[] | {id, body, created_at, ${USER_JQ}}`;
export const REVIEW_COMMENTS_JQ = `${HUNK_TAIL_JQ}
.[] | ([20, ((.line // 0) - (.start_line // .line // 0) + 1)] | max) as $keep
| {id, body, created_at, ${USER_JQ}, path, line, start_line, side, position, in_reply_to_id, pull_request_review_id, subject_type, diff_hunk: (.diff_hunk | if type == "string" then hunk_tail($keep) else null end)}`;

function sideOf(value: unknown): "LEFT" | "RIGHT" | undefined {
	return value === "LEFT" || value === "RIGHT" ? value : undefined;
}

export function parseJsonLines(output: string): unknown[] {
	const values: unknown[] = [];
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			values.push(JSON.parse(trimmed));
		} catch {
			// 跳过无法解析的行
		}
	}
	return values;
}

export function parsePullRequestComments(output: string, kind: PullRequestCommentKind): PullRequestComment[] {
	return parseJsonLines(output).flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const record = entry as Record<string, unknown>;
		const id = countOf(record.id);
		const body = typeof record.body === "string" ? record.body : "";
		const author = record.user === null ? "ghost" : stringFieldOf(record.user, "login");
		const createdAt = isoOf(record.created_at);
		if (id === undefined || !author || !createdAt) return [];
		const path = branchOf(record.path);
		const onFile = record.subject_type === "file";
		const line = onFile ? undefined : countOf(record.line);
		const diffHunk = branchOf(record.diff_hunk);
		const inReplyToId = countOf(record.in_reply_to_id);
		const reviewId = countOf(record.pull_request_review_id);
		const side = sideOf(record.side);
		const startLine = onFile ? undefined : countOf(record.start_line);
		const positioned = kind === "review" && "position" in record;
		return [
			{
				id,
				author,
				body,
				createdAt,
				kind,
				...(path ? { path } : {}),
				...(line !== undefined ? { line } : {}),
				...(diffHunk ? { diffHunk } : {}),
				...(inReplyToId !== undefined ? { inReplyToId } : {}),
				...(reviewId !== undefined ? { reviewId } : {}),
				...(side ? { side } : {}),
				...(startLine !== undefined ? { startLine } : {}),
				...(positioned ? { outdated: record.position === null } : {}),
			},
		];
	});
}

const GIT_ESCAPES: Record<string, string> = {
	n: "\n",
	t: "\t",
	r: "\r",
	a: "\x07",
	b: "\b",
	f: "\f",
	v: "\v",
	'"': '"',
	"\\": "\\",
};

export function unquoteGitPath(value: string): string {
	if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
	const bytes: number[] = [];
	const inner = value.slice(1, -1);
	for (const match of inner.matchAll(/\\([0-7]{1,3})|\\(.)|([^\\]+)/gs)) {
		const [, octal, escaped, plain] = match;
		if (octal !== undefined) {
			bytes.push(Number.parseInt(octal, 8));
			continue;
		}
		if (escaped !== undefined) {
			bytes.push(...Buffer.from(GIT_ESCAPES[escaped] ?? escaped, "utf8"));
			continue;
		}
		bytes.push(...Buffer.from(plain ?? "", "utf8"));
	}
	return Buffer.from(bytes).toString("utf8");
}

export function diffSideHeaderPath(line: string): { side: "a" | "b"; path: string } | null {
	if (!line.startsWith("+++ ") && !line.startsWith("--- ")) return null;
	const side = line.startsWith("+++ ") ? "b" : "a";
	const target = unquoteGitPath(line.slice(4).replace(/\t$/, ""));
	const prefix = `${side}/`;
	if (!target.startsWith(prefix)) return null;
	return { side, path: target.slice(prefix.length) };
}

export function diffRenameToPath(line: string): string | null {
	if (!line.startsWith("rename to ")) return null;
	return unquoteGitPath(line.slice("rename to ".length));
}

export function diffGitHeaderPath(line: string): string | null {
	if (!line.startsWith("diff --git ")) return null;
	const rest = line.slice("diff --git ".length);
	const quoted = rest.match(/"((?:[^"\\]|\\.)*)"$/);
	if (quoted) {
		const target = unquoteGitPath(`"${quoted[1] ?? ""}"`);
		return target.startsWith("b/") ? target.slice(2) : null;
	}
	const middle = (rest.length - 1) / 2;
	if (Number.isInteger(middle) && rest[middle] === " ") {
		const left = rest.slice(0, middle);
		const right = rest.slice(middle + 1);
		if (left.startsWith("a/") && right.startsWith("b/") && left.slice(2) === right.slice(2)) {
			return right.slice(2);
		}
	}
	const split = rest.lastIndexOf(" b/");
	return split === -1 ? null : rest.slice(split + " b/".length);
}

export function diffSectionPath(section: string): string | null {
	let fromSide: string | null = null;
	let header: string | null = null;
	for (const line of section.split("\n")) {
		if (line.startsWith("@@")) break;
		const side = diffSideHeaderPath(line);
		if (side?.side === "b") return side.path;
		if (side?.side === "a") fromSide = side.path;
		const renamed = diffRenameToPath(line);
		if (renamed !== null) return renamed;
		if (line.startsWith("diff --git ")) header = line;
	}
	if (fromSide !== null) return fromSide;
	return header ? diffGitHeaderPath(header) : null;
}

export function filterUnifiedDiff(patch: string, paths: string[]): string {
	const wanted = new Set(paths);
	if (wanted.size === 0) return patch;
	return patch
		.split(/^(?=diff --git )/m)
		.filter((section) => {
			if (!section.startsWith("diff --git ")) return false;
			const sectionPath = diffSectionPath(section);
			return sectionPath !== null && wanted.has(sectionPath);
		})
		.join("");
}

export type ParsedDiffFile = { path: string; previousPath: string | null; diff: string };

export function splitUnifiedDiff(patch: string): ParsedDiffFile[] {
	return patch
		.split(/^(?=diff --git )/m)
		.filter((section) => section.startsWith("diff --git "))
		.map((section) => {
			const header = section.split("\n")[0] ?? "";
			const previous = diffSideHeaderPath(section.split("\n").find((line) => line.startsWith("--- ")) ?? "");
			const current = diffSideHeaderPath(section.split("\n").find((line) => line.startsWith("+++ ")) ?? "");
			return {
				path: diffSectionPath(section) ?? diffGitHeaderPath(header) ?? "",
				previousPath: previous && current && previous.path !== current.path ? previous.path : null,
				diff: section,
			};
		});
}

export function parsePullRequestUrl(
	text: string,
): { url: string; host: string; owner: string; repo: string; number: number } | null {
	const match = /https:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i.exec(text);
	if (!match) return null;
	const [, host, owner, repo, digits] = match;
	const number = Number(digits);
	if (!host || !owner || !repo) return null;
	if (!Number.isSafeInteger(number) || number <= 0) return null;
	return { url: `https://${host}/${owner}/${repo}/pull/${number}`, host, owner, repo, number };
}

const GITHUB_IMAGE_HOSTS = new Set([
	"avatars.githubusercontent.com",
	"camo.githubusercontent.com",
	"private-user-images.githubusercontent.com",
	"user-images.githubusercontent.com",
]);

const GITHUB_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;
const MAX_CACHED_IMAGES = 500;
const MAX_CACHED_IMAGE_BYTES = 64 * 1024 * 1024;
const ATTACHMENT_PREFIX = "https://github.com/user-attachments/assets/";
const ATTACHMENT_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}$/i;
const PRIVATE_IMAGE_FILE = /^\d+-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.\w+$/i;
const HTML_TAG = /<(\/?)(a|img)\b([^>]*)>/gi;
const HTML_ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const HTML_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&quot;": '"',
	"&#39;": "'",
	"&#x27;": "'",
	"&lt;": "<",
	"&gt;": ">",
};

function decodeEntities(value: string): string {
	return value.replace(/&(?:amp|quot|#39|#x27|lt|gt);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

function attributesOf(source: string): Map<string, string> {
	const attributes = new Map<string, string>();
	for (const match of source.matchAll(HTML_ATTRIBUTE)) {
		const name = match[1]?.toLowerCase();
		const value = match[2] ?? match[3] ?? match[4];
		if (!name || value === undefined || attributes.has(name)) continue;
		attributes.set(name, decodeEntities(value));
	}
	return attributes;
}

function allowedImageUrl(url: string): URL | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") return null;
	if (parsed.username || parsed.password || parsed.port) return null;
	if (!GITHUB_IMAGE_HOSTS.has(parsed.hostname)) return null;
	return parsed;
}

function attachmentOfPrivateImage(source: URL): string | null {
	if (source.hostname !== "private-user-images.githubusercontent.com") return null;
	const file = source.pathname.split("/").pop() ?? "";
	const uuid = PRIVATE_IMAGE_FILE.exec(file)?.[1];
	return uuid ? `${ATTACHMENT_PREFIX}${uuid.toLowerCase()}` : null;
}

function keysOfImage(attributes: Map<string, string>, source: URL, href: string | null): string[] {
	const keys = [source.href];
	const canonical = attributes.get("data-canonical-src");
	if (source.hostname === "camo.githubusercontent.com" && canonical) keys.push(canonical);
	if (href && ATTACHMENT_URL.test(href)) keys.push(href);
	const attachment = attachmentOfPrivateImage(source);
	if (attachment) keys.push(attachment);
	return keys;
}

export function imagesOfHtml(html: string): Record<string, string> {
	const images: Record<string, string> = {};
	let href: string | null = null;
	for (const match of html.matchAll(HTML_TAG)) {
		const closing = match[1] === "/";
		const tag = match[2]?.toLowerCase();
		const attributes = attributesOf(match[3] ?? "");
		if (tag === "a") {
			href = closing ? null : (attributes.get("href") ?? null);
			continue;
		}
		const src = attributes.get("src");
		const source = src ? allowedImageUrl(src) : null;
		if (!src || !source) continue;
		for (const key of keysOfImage(attributes, source, href)) images[key] = src;
	}
	return images;
}

export function avatarsOf(author: { login: string; avatarUrl: string; __typename?: string } | null): Record<string, string> {
	if (!author?.avatarUrl) return {};
	if (author.__typename !== "Bot") return { [author.login]: author.avatarUrl };
	return { [author.login]: author.avatarUrl, [`${author.login}[bot]`]: author.avatarUrl };
}

function mimeOf(response: Response): string {
	const header = response.headers.get("content-type") ?? "";
	return header.split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export type ImageFetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function downloadImage(
	url: string,
	fetchImpl: ImageFetcher,
	timeoutMs: number,
): Promise<{ success: true; dataUrl: string } | { success: false; error: string }> {
	const response = await fetchImpl(url, {
		signal: AbortSignal.timeout(timeoutMs),
		headers: { Accept: "image/*", "User-Agent": "pi-desktop" },
	});
	if (response.url && !allowedImageUrl(response.url)) return { success: false, error: "Image left GitHub." };
	if (!response.ok) return { success: false, error: `Image request failed (${response.status}).` };
	const mime = mimeOf(response);
	if (!/^image\/[\w.+-]+$/.test(mime)) return { success: false, error: "Not an image." };
	const declared = Number(response.headers.get("content-length") ?? 0);
	if (declared > GITHUB_IMAGE_MAX_BYTES) return { success: false, error: "Image is too large." };
	const bytes = await readCapped(response, GITHUB_IMAGE_MAX_BYTES);
	if (!bytes) return { success: false, error: "Image is too large." };
	if (bytes.byteLength === 0) return { success: false, error: "Image is empty." };
	return { success: true, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
}

export type { GitHubImageResult };

export function createGitHubImageLoader(options: { fetchImpl?: ImageFetcher; timeoutMs?: number } = {}) {
	const fetchImpl: ImageFetcher = options.fetchImpl ?? netFetch;
	const timeoutMs = options.timeoutMs ?? IMAGE_TIMEOUT_MS;
	const cache = new Map<string, string>();
	const inFlight = new Map<string, Promise<GitHubImageResult>>();
	let cachedBytes = 0;

	const remember = (url: string, dataUrl: string): void => {
		cache.set(url, dataUrl);
		cachedBytes += dataUrl.length;
		for (const [oldest, value] of cache) {
			if (cache.size <= MAX_CACHED_IMAGES && cachedBytes <= MAX_CACHED_IMAGE_BYTES) return;
			cache.delete(oldest);
			cachedBytes -= value.length;
		}
	};

	const load = async (url: string): Promise<GitHubImageResult> => {
		try {
			const result = await downloadImage(url, fetchImpl, timeoutMs);
			if (result.success) remember(url, result.dataUrl);
			return result;
		} catch {
			return { success: false, error: "Could not load this image." };
		} finally {
			inFlight.delete(url);
		}
	};

	return async (url: string): Promise<GitHubImageResult> => {
		if (typeof url !== "string" || !allowedImageUrl(url)) {
			return { success: false, error: "Only GitHub images can be loaded." };
		}
		const cached = cache.get(url);
		if (cached) return { success: true, dataUrl: cached };
		const pending = inFlight.get(url);
		if (pending) return pending;
		const started = load(url);
		inFlight.set(url, started);
		return started;
	};
}

const URL_PATTERN = /^https:\/\/([\w.-]+)\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d{0,9})\/?$/;

export type PullRequestAddress = { hostname: string; repository: string; number: number };

export function pullRequestAddress(url: string): PullRequestAddress {
	const match = URL_PATTERN.exec(url);
	if (!match?.[1] || !match[2] || !match[3]) {
		throw githubError({ reason: "failed", message: "Not a pull request link." });
	}
	return { hostname: match[1], repository: match[2], number: Number(match[3]) };
}

export function requireNumber(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw githubError({ reason: "failed", message: `Not a pull request number: ${String(value)}` });
	}
	return value as number;
}

export const loadGitHubImage = createGitHubImageLoader();
