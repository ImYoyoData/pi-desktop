import fs from "node:fs";
import path from "node:path";
import type { PullRequestDetail, PullRequestPage } from "../shared/github-types";
import { agentDir } from "./agent-dir";
import type { TtlCacheEntry, TtlCacheOptions } from "./github-list";

const WRITE_DELAY_MS = 800;

const PAGE_FILE = "desktop-github-pages.json";
const DETAIL_FILE = "desktop-github-details.json";
const PAGE_LIMIT = 48;
const DETAIL_LIMIT = 8;
const PAGE_FRESH_MS = 5 * 60 * 1000;
const PAGE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const DETAIL_CACHE_TTL_MS = 60 * 1000;
const DETAIL_STALE_MS = 24 * 60 * 60 * 1000;

type Entries<T> = Record<string, TtlCacheEntry<T>>;

type JsonStore<T> = {
	load: () => Entries<T>;
	save: (entries: Entries<T>) => void;
};

/** 一个命名空间一个文件：写列表页时不会把详情整份序列化一遍。 */
function jsonStore<T>(fileName: string): JsonStore<T> {
	let entries: Entries<T> | null = null;
	let timer: NodeJS.Timeout | null = null;

	const pathOf = (): string => path.join(agentDir(), fileName);

	const read = (): Entries<T> => {
		if (entries) return entries;
		entries = {};
		try {
			const parsed = JSON.parse(fs.readFileSync(pathOf(), "utf8")) as { version?: unknown; entries?: unknown };
			if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === "object") {
				entries = parsed.entries as Entries<T>;
			}
		} catch {
			// 文件缺失或损坏：按空缓存处理
		}
		return entries;
	};

	const flush = (): void => {
		try {
			const target = pathOf();
			fs.mkdirSync(path.dirname(target), { recursive: true });
			const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }), "utf8");
			fs.renameSync(tmp, target);
		} catch {
			// 落盘失败只影响下次启动的预热
		}
	};

	const schedule = (): void => {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			flush();
		}, WRITE_DELAY_MS);
		timer.unref();
	};

	return {
		load: read,
		save: (next) => {
			entries = next;
			schedule();
		},
	};
}

const pages = jsonStore<PullRequestPage>(PAGE_FILE);
const details = jsonStore<PullRequestDetail>(DETAIL_FILE);

export const PULL_REQUEST_PAGE_TTL_MS = PAGE_FRESH_MS;

export function pageCacheOptions(): TtlCacheOptions<PullRequestPage> {
	return { staleMs: PAGE_STALE_MS, limit: PAGE_LIMIT, load: pages.load, save: pages.save };
}

export function detailCacheOptions(): TtlCacheOptions<PullRequestDetail> {
	return { staleMs: DETAIL_STALE_MS, limit: DETAIL_LIMIT, load: details.load, save: details.save };
}
