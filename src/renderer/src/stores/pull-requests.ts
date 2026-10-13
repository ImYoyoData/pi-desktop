import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
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

const SELECTION_KEY = "pi-desktop:pull-request-selection:v1";
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

function mergeByUrl(current: PullRequestSummary[], incoming: PullRequestSummary[]): PullRequestSummary[] {
	return [...new Map([...current, ...incoming].map((entry) => [entry.url, entry])).values()];
}

export const usePullRequestsStore = defineStore("pullRequests", () => {
	const workspace = useWorkspaceStore();
	const selection = ref<PullRequestSelection>(readPullRequestSelection());
	const list = ref<ListState>({ key: "", ...EMPTY_LIST });
	const cache = new Map<string, Omit<ListState, "key">>();
	const pending = new Set<string>();
	let generation = 0;
	let activeKey = "";

	const filtersJson = computed(() => serializeFilters(selection.value.filters));
	const key = computed(() =>
		JSON.stringify([
			workspace.root ?? "",
			selection.value.state,
			selection.value.author,
			filtersJson.value,
		]),
	);

	function persistSelection(): void {
		try {
			prefs.setItem(SELECTION_KEY, JSON.stringify(selection.value));
		} catch {
			// 忽略存储失败
		}
	}

	function cancelPending(): void {
		for (const requestId of pending) void window.api.github.pullRequestListCancel(requestId);
		pending.clear();
	}

	async function fetchPage(currentKey: string, cursor?: string) {
		const requestId = crypto.randomUUID();
		pending.add(requestId);
		try {
			const filters =
				filtersJson.value === "{}" ? undefined : (JSON.parse(filtersJson.value) as PullRequestFilters);
			if (filters?.updatedWithin) {
				const days = filters.updatedWithin;
				delete filters.updatedWithin;
				filters.updatedAfter = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
			}
			const response = await window.api.github
				.pullRequestList(
					plainIpcArgs({
						state: selection.value.state,
						author: selection.value.author,
						...(filters ? { filters } : {}),
						...(cursor ? { cursor } : {}),
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
		if (!workspace.root) return;
		const currentKey = key.value;
		const cached = cache.get(currentKey);
		if (!force && list.value.key === currentKey) return;
		cancelPending();
		const run = ++generation;
		activeKey = currentKey;
		const previous = cached ?? EMPTY_LIST;
		const targetCount = previous.pullRequests.length;
		list.value = {
			...previous,
			key: currentKey,
			loading: !force,
			loadingMore: force,
			error: null,
			moreError: null,
		};
		try {
			const first = await fetchPage(currentKey);
			let rows = first.pullRequests ?? [];
			let cursor = first.nextCursor ?? null;
			for (let page = 1; page < MAX_LIST_PAGES && cursor && rows.length < targetCount; page += 1) {
				const next = await fetchPage(currentKey, cursor);
				rows = mergeByUrl(rows, next.pullRequests ?? []);
				cursor = next.nextCursor ?? null;
			}
			if (run !== generation) return;
			const settled: Omit<ListState, "key"> = {
				pullRequests: rows,
				nextCursor: cursor,
				totalCount: first.totalCount ?? 0,
				counts: first.counts ?? null,
				repository: first.repository ?? null,
				loading: false,
				loadingMore: false,
				error: null,
				moreError: null,
			};
			cache.set(currentKey, settled);
			trimCache();
			list.value = { ...settled, key: currentKey };
		} catch (error) {
			if (error === SUPERSEDED || run !== generation) return;
			const message = error instanceof Error ? error.message : String(error);
			list.value = { ...list.value, loading: false, loadingMore: false, error: message, moreError: null };
		}
	}

	async function loadMore(): Promise<void> {
		const currentKey = list.value.key;
		if (!workspace.root || list.value.key !== key.value || !list.value.nextCursor) return;
		if (list.value.loadingMore) return;
		const run = generation;
		const cursor = list.value.nextCursor;
		list.value = { ...list.value, loadingMore: true, moreError: null };
		try {
			const next = await fetchPage(currentKey, cursor);
			if (run !== generation) return;
			const settled: Omit<ListState, "key"> = {
				pullRequests: mergeByUrl(list.value.pullRequests, next.pullRequests ?? []),
				nextCursor: next.nextCursor ?? null,
				totalCount: list.value.totalCount,
				counts: list.value.counts,
				repository: list.value.repository,
				loading: false,
				loadingMore: false,
				error: null,
				moreError: null,
			};
			cache.set(currentKey, settled);
			list.value = { ...settled, key: currentKey };
		} catch (error) {
			if (error === SUPERSEDED || run !== generation) return;
			const message = error instanceof Error ? error.message : String(error);
			list.value = { ...list.value, loadingMore: false, moreError: message };
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
		const next: PullRequestSelection = {
			state: patch.state ?? selection.value.state,
			author: patch.author ?? selection.value.author,
			filters: patch.filters ?? selection.value.filters,
		};
		selection.value = next;
		persistSelection();
		void load();
	}

	function setFilter(key: keyof PullRequestFilters, value: PullRequestFilters[keyof PullRequestFilters] | undefined): void {
		const filters = { ...selection.value.filters };
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

	watch(
		() => key.value,
		(current, previous) => {
			if (current === previous) return;
			void load();
		},
	);

	watch(
		() => workspace.root,
		() => {
			generation += 1;
			cancelPending();
			cache.clear();
			list.value = { key: "", ...EMPTY_LIST };
			void load();
		},
	);

	return {
		selection,
		list,
		key,
		load,
		loadMore,
		refresh,
		setSelection,
		setFilter,
		clearFilters,
	};
});
