import { ipcMain } from "electron";
import { z } from "zod";
import { IpcChannels } from "../shared/protocol";
import type {
	GitHubResponse,
	PullRequestCounts,
	PullRequestPage,
	PullRequestPatchResult,
	PullRequestSummary,
} from "../shared/github-types";
import { getWorkspace } from "./workspace-ipc";
import { githubClient, isGitHubError, loadGitHubImage } from "./github-host";
import { parsePullRequestAction } from "./github-detail";
import { PullRequestFiltersSchema } from "./github-list";

const RequestIdSchema = z.string().regex(/^[\w-]{1,64}$/);

const PullRequestTargetSchema = z.object({
	cwd: z.string().min(1).optional(),
	url: z.url({ protocol: /^https$/ }).max(2048),
	fresh: z.boolean().optional(),
});

const PullRequestListSchema = z.object({
	cwd: z.string().min(1).optional(),
	state: z.enum(["open", "closed", "merged", "all"]),
	author: z.enum(["mine", "all"]).default("mine"),
	filters: PullRequestFiltersSchema.optional(),
	cursor: z.string().min(1).max(2048).optional(),
	requestId: RequestIdSchema.optional(),
	fresh: z.boolean().optional(),
});

const PatchHeadSchema = z.object({
	headSha: z
		.string()
		.regex(/^[0-9a-f]{40}$/)
		.optional()
		.catch(undefined),
});

const ChoiceKindSchema = z.object({ kind: z.enum(["labels", "people", "milestones", "branches"]) });

const BRANCH_SCHEMA = z.object({ branch: z.string().min(1).max(200) });

function workspaceRoot(): string | null {
	return getWorkspace();
}

function failure(error: unknown, fallback: string): { success: false; error: string } {
	return { success: false, error: isGitHubError(error) ? error.github.message : fallback };
}

function isCancelledError(error: unknown): boolean {
	return isGitHubError(error) && error.github.reason === "cancelled";
}

export function registerGitHubIpc(): void {
	const listRequests = new Map<string, AbortController>();

	const target = (options: unknown): { root: string; url: string; fresh: boolean } | { error: string } => {
		const root = workspaceRoot();
		if (!root) return { error: "Open a project folder first." };
		const parsed = PullRequestTargetSchema.safeParse(options);
		if (!parsed.success) return { error: "Choose a valid pull request." };
		return { root, url: parsed.data.url, fresh: parsed.data.fresh === true };
	};

	ipcMain.handle(
		IpcChannels.github.pullRequestDetail,
		async (_event, options: unknown): Promise<GitHubResponse<{ detail: Awaited<ReturnType<typeof githubClient.pullRequestDetail>> }>> => {
			const resolved = target(options);
			if ("error" in resolved) return { success: false, error: resolved.error };
			try {
				return { success: true, detail: await githubClient.pullRequestDetail(resolved.root, resolved.url, resolved.fresh) };
			} catch (error) {
				return failure(error, "Could not load this pull request. Try again.");
			}
		},
	);

	ipcMain.handle(
		IpcChannels.github.pullRequestPatch,
		async (_event, options: unknown): Promise<GitHubResponse<PullRequestPatchResult>> => {
			const resolved = target(options);
			if ("error" in resolved) return { success: false, error: resolved.error };
			const head = PatchHeadSchema.safeParse(options);
			try {
				const snapshot = await githubClient.pullRequestPatch(
					resolved.root,
					resolved.url,
					head.success ? head.data.headSha : undefined,
				);
				return { success: true, ...snapshot };
			} catch (error) {
				return failure(error, "Could not load the changed files. Try again.");
			}
		},
	);

	ipcMain.handle(IpcChannels.github.pullRequestAction, async (_event, options: unknown): Promise<GitHubResponse<object>> => {
		const resolved = target(options);
		if ("error" in resolved) return { success: false, error: resolved.error };
		try {
			const action = parsePullRequestAction((options as { action?: unknown } | null)?.action);
			try {
				await githubClient.pullRequestAction(resolved.root, resolved.url, action);
			} finally {
				githubClient.invalidate(resolved.root);
			}
			return { success: true };
		} catch (error) {
			return failure(error, "Could not update this pull request. Try again.");
		}
	});

	ipcMain.handle(IpcChannels.github.pullRequestChoices, async (_event, options: unknown) => {
		const resolved = target(options);
		if ("error" in resolved) return { success: false, error: resolved.error };
		const parsed = ChoiceKindSchema.safeParse(options);
		if (!parsed.success) return { success: false, error: "Choose labels, people, milestones or branches." };
		try {
			return { success: true, ...(await githubClient.pullRequestChoices(resolved.root, resolved.url, parsed.data.kind)) };
		} catch (error) {
			return failure(error, "Could not load the choices. Try again.");
		}
	});

	ipcMain.handle(IpcChannels.github.repositoryChoices, async (_event, options: unknown) => {
		const root = workspaceRoot();
		if (!root) return { success: false, error: "Open a project folder first." };
		const parsed = ChoiceKindSchema.safeParse(options);
		if (!parsed.success) return { success: false, error: "Choose labels, people, milestones or branches." };
		try {
			return { success: true, ...(await githubClient.repositoryChoices(root, parsed.data.kind)) };
		} catch (error) {
			return failure(error, "Could not load the choices. Try again.");
		}
	});

	ipcMain.handle(IpcChannels.github.image, (_event, url: unknown) =>
		typeof url === "string" ? loadGitHubImage(url) : { success: false, error: "Only GitHub images can be loaded." },
	);

	ipcMain.handle(IpcChannels.github.pullRequestList, async (_event, options: unknown): Promise<GitHubResponse<PullRequestPage>> => {
		const parsed = PullRequestListSchema.safeParse(options);
		if (!parsed.success) {
			return { success: false, error: "Choose a repository and valid pull request filters." };
		}
		const root = workspaceRoot();
		if (!root) return { success: false, error: "Open a project folder first." };
		const { state, author, cursor, filters, requestId, fresh } = parsed.data;
		const controller = new AbortController();
		if (requestId) {
			listRequests.get(requestId)?.abort();
			listRequests.set(requestId, controller);
		}
		try {
			const page = await githubClient.listPullRequests(root, state, author, cursor, filters, controller.signal, fresh);
			return { success: true, ...page };
		} catch (error) {
			if (controller.signal.aborted || isCancelledError(error)) {
				return { success: false, cancelled: true, error: "Cancelled." };
			}
			return failure(error, "Could not load pull requests. Try refreshing.");
		} finally {
			if (requestId && listRequests.get(requestId) === controller) listRequests.delete(requestId);
		}
	});

	ipcMain.handle(IpcChannels.github.pullRequestListCancel, (_event, requestId: unknown) => {
		const parsed = RequestIdSchema.safeParse(requestId);
		if (!parsed.success) return;
		listRequests.get(parsed.data)?.abort();
		listRequests.delete(parsed.data);
	});

	ipcMain.handle(
		IpcChannels.github.pullRequestCounts,
		async (_event, options: unknown): Promise<GitHubResponse<{ counts?: PullRequestCounts }>> => {
			const parsed = PullRequestListSchema.safeParse(options);
			if (!parsed.success) return { success: false, error: "Choose a repository and valid pull request filters." };
			const root = workspaceRoot();
			if (!root) return { success: false, error: "Open a project folder first." };
			const { state, author, filters, requestId, fresh } = parsed.data;
			const controller = new AbortController();
			if (requestId) {
				listRequests.get(requestId)?.abort();
				listRequests.set(requestId, controller);
			}
			try {
				const counts = await githubClient.pullRequestCounts({
					cwd: root,
					state,
					author,
					filters,
					signal: controller.signal,
					fresh,
				});
				return counts ? { success: true, counts } : { success: true };
			} catch (error) {
				if (controller.signal.aborted || isCancelledError(error)) {
					return { success: false, cancelled: true, error: "Cancelled." };
				}
				return failure(error, "Could not load pull request counts.");
			} finally {
				if (requestId && listRequests.get(requestId) === controller) listRequests.delete(requestId);
			}
		},
	);

	ipcMain.handle(
		IpcChannels.github.pullRequest,
		async (_event, branch: unknown): Promise<GitHubResponse<{ pullRequest: PullRequestSummary | null }>> => {
			const root = workspaceRoot();
			if (!root) return { success: false, error: "Open a project folder first." };
			const parsed = BRANCH_SCHEMA.safeParse({ branch });
			if (!parsed.success) return { success: false, error: "Choose a valid branch." };
			try {
				return { success: true, pullRequest: await githubClient.pullRequestForBranch(root, parsed.data.branch) };
			} catch (error) {
				return failure(error, "Could not load the pull request for this branch.");
			}
		},
	);

	ipcMain.handle(
		IpcChannels.github.pullRequestView,
		async (_event, url: unknown): Promise<GitHubResponse<{ pullRequest: PullRequestSummary }>> => {
			const root = workspaceRoot();
			if (!root) return { success: false, error: "Open a project folder first." };
			const parsed = z.url({ protocol: /^https$/ }).max(2048).safeParse(url);
			if (!parsed.success) return { success: false, error: "Choose a valid pull request." };
			try {
				return { success: true, pullRequest: await githubClient.pullRequestByUrl(root, parsed.data) };
			} catch (error) {
				return failure(error, "Could not load this pull request. Try again.");
			}
		},
	);
}
