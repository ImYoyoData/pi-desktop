import { app } from "electron";
import { existsSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Chromium disk-cache guard.
 *
 * Symptom (Windows): at startup Chromium logs
 *   net\disk_cache\cache_util_win.cc:25 Unable to move the cache: 拒绝访问 (0x5)
 *   net\disk_cache\disk_cache.cc:236 Unable to create cache
 *   gpu\ipc\host\gpu_disk_cache.cc:724 Gpu Cache Creation failed: -2
 *
 * Cause: the userData cache dirs (Cache / GPUCache / Code Cache / Dawn*) are
 * left behind by a previous run — an earlier run crashed, an AV scanner has
 * a file open, or (packaged-only) a second instance held them. Chromium tries
 * to move the old dir away before creating a fresh one; when the move fails
 * with ERROR_ACCESS_DENIED it falls back to a memory cache and spams stderr.
 * (Dev builds now use their own userData dir — see main/index.ts — so
 * parallel dev + packaged instances no longer share these dirs at all.)
 *
 * Fix: before any BrowserWindow exists, probe each cache dir and delete the
 * ones that are unusable. A *usable* (writable, non-corrupt) dir is left
 * alone so the disk cache keeps working normally; only dirs we cannot write
 * into are removed. All of these are pure caches — Chromium recreates them
 * on demand.
 */

const CACHE_DIRS = [
	"Cache",
	"GPUCache",
	"Code Cache",
	"DawnGraphiteCache",
	"DawnWebGPUCache",
];

/** Probe + reset unusable Chromium cache dirs under the default userData. */
export function guardChromiumCacheDirs(): void {
	const userData = app.getPath("userData");
	for (const name of CACHE_DIRS) {
		const dir = join(userData, name);
		if (!existsSync(dir)) continue;

		if (dirUsable(dir)) {
			continue;
		}
		try {
			rmSync(dir, { recursive: true, force: true });
			console.warn(`[cache-guard] reset unusable cache dir: ${dir}`);
		} catch (err) {
			// Still locked by a live process — best effort, Chromium falls back
			// to a memory cache for this session.
			console.warn(`[cache-guard] could not reset cache dir ${dir}:`, err);
		}
	}
}

/** A dir is usable when we can create + delete a probe file inside it. */
function dirUsable(dir: string): boolean {
	if (!existsSync(dir)) return false;
	try {
		const stats = statSync(dir);
		if (!stats.isDirectory()) return false;
		const probe = join(dir, `.pi-cache-probe-${process.pid}`);
		writeFileSync(probe, "");
		rmSync(probe);
		return true;
	} catch {
		return false;
	}
}
