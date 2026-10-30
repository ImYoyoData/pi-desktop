import { create } from "zustand";
import type {
	PullRequestCounts,
	PullRequestFilters,
	PullRequestListAuthor,
	PullRequestListState,
	PullRequestSort,
	PullRequestSummary,
} from "../../../shared/github-types";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { plainIpcArgs } from "@renderer/utils/ipc-plain";
import * as prefs from "@renderer/utils/prefs";

export const SELECTION_KEY = "pi-desktop:pull-request-selection:v1";
const MAX_LIST_PAGES = 10;
const STATE_CACHE_LIMIT = 30;

export type PullRequestSelection = {
	state: PullRequestListState;
	author: PullRequestListAuthor;
	filters: PullRequestFilters;
};

const DEFAULT_SELECTION: PullRequestSelection = { state: "open", author: "mine", filters: {} };

const STATES: PullRequestListState[] = ["open", "closed", "merged", "all"];
const AUTHORS: PullRequestListAuthor[] = ["mine", "all"];
const SORTS: PullRequestSort[] = [
	"updated-desc",
	"updated-asc",
	"created-desc",
	"created-asc",
	"comments-desc",
	"comments-asc",
	"reactions-desc",
	"interactions-desc",
];
const REVIEW_FILTERS = ["none", "required", "approved", "changes-requested"] as const;
const CHECK_FILTERS = ["success", "failure", "pending", "none"] as const;
const TEXT_KEYS = [
	"text",
	"author",
	"mentions",
	"involves",
	"commenter",
	"reviewRequested",
	"reviewedBy",
	"milestone",
	"base",
	"head",
	"createdAfter",
	"updatedAfter",
] as const;

export function readPullRequestSelection(): PullRequestSelection {
	try {
		const raw = prefs.getItem(SELECTION_KEY);
		if (!raw) return { ...DEFAULT_SELECTION, filters: {} };
		const parsed = JSON.parse(raw) as Partial<PullRequestSelection> & { filters?: unknown };
		return {
			state: STATES.includes(parsed.state as PullRequestListState)
				? (parsed.state as PullRequestListState)
				: DEFAULT_SELECTION.state,
			author: AUTHORS.includes(parsed.author as PullRequestListAuthor)
				? (parsed.author as PullRequestListAuthor)
				: DEFAULT_SELECTION.author,
			filters: normalizeFilters(parsed.filters),
		};
	} catch {
		return { ...DEFAULT_SELECTION, filters: {} };
	}
}

function normalizeFilters(raw: unknown): PullRequestFilters {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const source = raw as Record<string, unknown>;
	const filters: PullRequestFilters = {};
	for (const key of TEXT_KEYS) {
		const value = source[key];
		if (typeof value === "string" && value.trim()) filters[key] = value.trim();
	}
	const assignee = source.assignee;
	if (typeof assignee === "string" && assignee.trim()) filters.assignee = assignee.trim();
	const review = source.review;
	if (typeof review === "string" && REVIEW_FILTERS.includes(review as (typeof REVIEW_FILTERS)[number])) {
		filters.review = review as PullRequestFilters["review"];
	}
	const checks = source.checks;
	if (typeof checks === "string" && CHECK_FILTERS.includes(checks as (typeof CHECK_FILTERS)[number])) {
		filters.checks = checks as PullRequestFilters["checks"];
	}
	if (typeof source.draft === "boolean") filters.draft = source.draft;
	if (source.noLabel === true) filters.noLabel = true;
	if (source.updatedWithin === 7 || source.updatedWithin === 30) filters.updatedWithin = source.updatedWithin;
	if (source.linked === "issue") filters.linked = "issue";
	if (Array.isArray(source.labels)) {
		const labels = source.labels.filter((label): label is string => typeof label === "string" && Boolean(label.trim()));
		if (labels.length) filters.labels = labels.slice(0, 20);
	}
	const sort = source.sort;
	if (typeof sort === "string" && SORTS.includes(sort as PullRequestSort)) filters.sort = sort as PullRequestSort;
	return filters;
}

/** 稳定序列化筛选：忽略空值并按键排序，避免同一组筛选产生不同 key。 */
export function serializeFilters(filters: PullRequestFilters): string {
	const entries = Object.entries(normalizeFilters(filters))
		.filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ""))
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => (Array.isArray(value) ? [key, [...value].sort()] : [key, value]));
	return JSON.stringify(Object.fromEntries(entries));
}

type ListState = {
	key: string;
	pullRequests: PullRequestSummary[];
	loading: boolean;
	error: string | null;
	loadingMore: boolean;
	moreError: string | null;
	nextCursor: string | null;
	totalCount: number;
	counts: PullRequestCounts | null;
	repository: string | null;
};

const EMPTY_LIST: Omit<ListState, "key"> = {
	pullRequests: [],
	loading: false,
	error: null,
	loadingMore: false,
	moreError: null,
	nextCursor: null,
	totalCount: 0,
	counts: null,
	repository: null,
};

const SUPERSEDED = Symbol("superseded");

/** 工作区路径比较（分隔符与大小写无关）。 */
function sameWorkspacePath(a: string, b: string): boolean {
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return norm(a) === norm(b);
}

function mergeByUrl(current: PullRequestSummary[], incoming: PullRequestSummary[]): PullRequestSummary[] {
	return [...new Map([...current, ...incoming].map((entry) => [entry.url, entry])).values()];
}

type PullRequestsBase = {
	selection: PullRequestSelection;
	list: ListState;
	workspaceRoot: string | null;
	/** 选中的仓库目录；null 表示跟随当前工作区。 */
	repoRoot: string | null;
	/** 仓库目录 → GitHub 仓库名（owner/repo）。 */
	repositoryNames: Record<string, string>;
};

type PullRequestsDerived = {
	filtersJson: string;
	key: string;
	cwd: string | null;
};

function derive(base: PullRequestsBase): PullRequestsDerived {
	const filtersJson = serializeFilters(base.selection.filters);
	const cwd = base.repoRoot ?? base.workspaceRoot;
	const key = JSON.stringify([
		cwd ?? "",
		base.selection.state,
		base.selection.author,
		filtersJson,
	]);
	return { filtersJson, key, cwd };
}

export type PullRequestsState = PullRequestsBase &
	PullRequestsDerived & {
		load: (force?: boolean) => Promise<void>;
		loadMore: () => Promise<void>;
		refresh: () => void;
		setSelection: (patch: Partial<PullRequestSelection>) => void;
		setFilter: (
			key: keyof PullRequestFilters,
			value: PullRequestFilters[keyof PullRequestFilters] | undefined,
		) => void;
		clearFilters: () => void;
		/** 切换拉取请求页查看的仓库目录。 */
		setRepoRoot: (root: string | null) => void;
		/** 另一端改了筛选后重新读取并应用。 */
		refreshFromPrefs: () => void;
	};

export const usePullRequestsStore = create<PullRequestsState>()((set, get) => {
	const cache = new Map<string, Omit<ListState, "key">>();
	const pending = new Set<string>();
	let inflight: { key: string; run: number; promise: Promise<void> } | null = null;
	let generation = 0;
	let activeKey = "";

	function commit(patch: Partial<PullRequestsBase>): void {
		set((state) => {
			const next = { ...state, ...patch };
			return { ...next, ...derive(next) };
		});
	}

	function persistSelection(): void {
		try {
			prefs.setItem(SELECTION_KEY, JSON.stringify(get().selection));
		} catch {
			// 忽略存储失败
		}
	}

	function cancelPending(): void {
		for (const requestId of pending) void window.api.github.pullRequestListCancel(requestId);
		pending.clear();
		inflight = null;
	}

	function filtersForRequest(): PullRequestFilters | undefined {
		const { filtersJson } = get();
		if (filtersJson === "{}") return undefined;
		const filters = JSON.parse(filtersJson) as PullRequestFilters;
		if (filters.updatedWithin) {
			const days = filters.updatedWithin;
			delete filters.updatedWithin;
			filters.updatedAfter = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
		}
		return filters;
	}

	async function refreshCounts(currentKey: string, run: number, fresh: boolean): Promise<void> {
		const state = get();
		if (state.key !== currentKey) return;
		const filters = filtersForRequest();
		try {
			const response = await window.api.github.pullRequestCounts(
				plainIpcArgs({
					...(state.cwd ? { cwd: state.cwd } : {}),
					state: state.selection.state,
					author: state.selection.author,
					...(filters ? { filters } : {}),
					...(fresh ? { fresh: true } : {}),
				}),
			);
			if (run !== generation || !response.success || !response.counts) return;
			const list = get().list;
			if (list.key !== currentKey) return;
			commit({ list: { ...list, counts: response.counts } });
		} catch {
			// 计数只是锦上添花，失败不影响列表
		}
	}

	async function fetchPage(currentKey: string, cursor?: string, fresh?: boolean) {
		const requestId = crypto.randomUUID();
		const state = get();
		pending.add(requestId);
		try {
			const filters = filtersForRequest();
			const response = await window.api.github
				.pullRequestList(
					plainIpcArgs({
						...(state.cwd ? { cwd: state.cwd } : {}),
						state: state.selection.state,
						author: state.selection.author,
						...(filters ? { filters } : {}),
						...(cursor ? { cursor } : {}),
						...(fresh ? { fresh: true } : {}),
						requestId,
					}),
				)
				.catch((error: unknown) => {
					if (currentKey !== activeKey) throw SUPERSEDED;
					throw error;
				});
			if (currentKey !== activeKey) throw SUPERSEDED;
			if (!response.success) {
				if (response.cancelled) throw SUPERSEDED;
				throw new Error(response.error);
			}
			return response;
		} finally {
			pending.delete(requestId);
		}
	}

	async function load(force = false): Promise<void> {
		const state = get();
		if (!state.cwd) return;
		const currentKey = state.key;
		if (!force && inflight && inflight.key === currentKey) return inflight.promise;
		if (!force && state.list.key === currentKey && !state.list.error) return;
		cancelPending();
		const run = ++generation;
		activeKey = currentKey;
		const previous = cache.get(currentKey) ?? EMPTY_LIST;
		const targetCount = previous.pullRequests.length;
		commit({
			list: {
				...previous,
				key: currentKey,
				loading: previous.pullRequests.length === 0,
				loadingMore: force,
				error: null,
				moreError: null,
			},
		});
		const promise = readList(currentKey, targetCount, force, run);
		inflight = { key: currentKey, run, promise };
		try {
			await promise;
		} finally {
			if (inflight?.run === run) inflight = null;
		}
	}

	function commitRows(
		currentKey: string,
		rows: PullRequestSummary[],
		cursor: string | null,
		meta: { totalCount: number; repository: string | null },
		loadingMore: boolean,
	): void {
		const settled: Omit<ListState, "key"> = {
			pullRequests: rows,
			nextCursor: cursor,
			totalCount: meta.totalCount,
			counts: get().list.counts,
			repository: meta.repository,
			loading: false,
			loadingMore,
			error: null,
			moreError: null,
		};
		cache.set(currentKey, settled);
		trimCache();
		const cwd = get().cwd;
		const names = cwd && meta.repository
			? { ...get().repositoryNames, [cwd]: meta.repository }
			: get().repositoryNames;
		commit({ list: { ...settled, key: currentKey }, repositoryNames: names });
	}

	async function readList(currentKey: string, targetCount: number, fresh: boolean, run: number): Promise<void> {
		try {
			const first = await fetchPage(currentKey, undefined, fresh);
			if (run !== generation) return;
			const meta = {
				totalCount: first.totalCount ?? 0,
				repository: first.repository ?? null,
			};
			let rows = first.pullRequests ?? [];
			let cursor = first.nextCursor ?? null;
			const stale = Boolean(first.stale) && !fresh;
			commitRows(currentKey, rows, cursor, meta, !stale && Boolean(cursor && rows.length < targetCount));
			void refreshCounts(currentKey, run, fresh);
			if (stale) {
				await readList(currentKey, targetCount, true, run);
				return;
			}
			for (let page = 1; page < MAX_LIST_PAGES && cursor && rows.length < targetCount; page += 1) {
				const next = await fetchPage(currentKey, cursor, fresh);
				rows = mergeByUrl(rows, next.pullRequests ?? []);
				cursor = next.nextCursor ?? null;
				if (run !== generation) return;
				commitRows(currentKey, rows, cursor, meta, Boolean(cursor && rows.length < targetCount));
			}
		} catch (error) {
			if (error === SUPERSEDED || run !== generation) return;
			const message = error instanceof Error ? error.message : String(error);
			const list = get().list;
			commit({
				list: { ...list, loading: false, loadingMore: false, error: message, moreError: null },
			});
		}
	}

	async function loadMore(): Promise<void> {
		const state = get();
		const currentKey = state.list.key;
		if (!state.cwd || state.list.key !== state.key || !state.list.nextCursor) return;
		if (state.list.loadingMore) return;
		const run = generation;
		const cursor = state.list.nextCursor;
		commit({ list: { ...state.list, loadingMore: true, moreError: null } });
		try {
			const next = await fetchPage(currentKey, cursor);
			if (run !== generation) return;
			const current = get().list;
			const settled: Omit<ListState, "key"> = {
				pullRequests: mergeByUrl(current.pullRequests, next.pullRequests ?? []),
				nextCursor: next.nextCursor ?? null,
				totalCount: current.totalCount,
				counts: current.counts,
				repository: current.repository,
				loading: false,
				loadingMore: false,
				error: null,
				moreError: null,
			};
			cache.set(currentKey, settled);
			commit({ list: { ...settled, key: currentKey } });
		} catch (error) {
			if (error === SUPERSEDED || run !== generation) return;
			const message = error instanceof Error ? error.message : String(error);
			const list = get().list;
			commit({ list: { ...list, loadingMore: false, moreError: message } });
		}
	}

	function trimCache(): void {
		while (cache.size > STATE_CACHE_LIMIT) {
			const oldest = cache.keys().next();
			if (oldest.done) break;
			cache.delete(oldest.value);
		}
	}

	function setSelection(patch: Partial<PullRequestSelection>): void {
		const current = get().selection;
		const next: PullRequestSelection = {
			state: patch.state ?? current.state,
			author: patch.author ?? current.author,
			filters: patch.filters ?? current.filters,
		};
		commit({ selection: next });
		persistSelection();
		void load();
	}

	function setFilter(key: keyof PullRequestFilters, value: PullRequestFilters[keyof PullRequestFilters] | undefined): void {
		const filters = { ...get().selection.filters };
		if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
			delete filters[key];
		} else {
			Object.assign(filters, { [key]: value });
		}
		setSelection({ filters });
	}

	function clearFilters(): void {
		setSelection({ filters: {} });
	}

	function refresh(): void {
		void load(true);
	}

	/** 切换拉取请求页查看的仓库目录；null 表示回到当前工作区。 */
	function setRepoRoot(root: string | null): void {
		const current = get();
		const next = root && current.workspaceRoot && sameWorkspacePath(root, current.workspaceRoot) ? null : root;
		if (next === current.repoRoot) return;
		commit({ repoRoot: next });
		void load();
	}

	function resetForWorkspace(root: string | null): void {
		generation += 1;
		cancelPending();
		const previousCwd = get().cwd;
		const nextCwd = get().repoRoot ?? root;
		if (previousCwd === nextCwd) {
			commit({ workspaceRoot: root });
		} else {
			cache.clear();
			commit({ workspaceRoot: root, list: { key: "", ...EMPTY_LIST } });
		}
		void load();
	}

	const base: PullRequestsBase = {
		selection: readPullRequestSelection(),
		list: { key: "", ...EMPTY_LIST },
		workspaceRoot: useWorkspaceStore.getState().root,
		repoRoot: null,
		repositoryNames: {},
	};

	useWorkspaceStore.subscribe((state, prev) => {
		if (state.root === prev.root) return;
		resetForWorkspace(state.root);
	});


	return {
		...base,
		...derive(base),
		load,
		loadMore,
		refresh,
		setSelection,
		setFilter,
		clearFilters,
		setRepoRoot,
		/** 另一端改了筛选后重新读取并应用。 */
		refreshFromPrefs: () => {
			commit({ selection: readPullRequestSelection() });
		},
	};
});
