const GITHUB_IMAGE_HOSTS = new Set([
	"avatars.githubusercontent.com",
	"camo.githubusercontent.com",
	"private-user-images.githubusercontent.com",
	"user-images.githubusercontent.com",
]);

const dataUrlCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();
const MAX_CACHED_IMAGES = 500;

function remember(url: string, dataUrl: string): void {
	dataUrlCache.set(url, dataUrl);
	while (dataUrlCache.size > MAX_CACHED_IMAGES) {
		const oldest = dataUrlCache.keys().next();
		if (oldest.done) break;
		dataUrlCache.delete(oldest.value);
	}
}

export function isGitHubImageUrl(url: string | undefined | null): boolean {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return false;
		if (parsed.username || parsed.password) return false;
		return GITHUB_IMAGE_HOSTS.has(parsed.hostname);
	} catch {
		return false;
	}
}

/** 经主进程代理加载 GitHub 图片（绕过网络/防盗链限制），结果按 URL 缓存。 */
export async function loadGithubImage(url: string): Promise<string | null> {
	if (!isGitHubImageUrl(url)) return null;
	const cached = dataUrlCache.get(url);
	if (cached !== undefined) return cached;
	const pending = inFlight.get(url);
	if (pending) return pending;
	const task = window.api.github
		.image(url)
		.then((response) => (response.success ? response.dataUrl : null))
		.catch(() => null)
		.finally(() => inFlight.delete(url));
	inFlight.set(url, task);
	const result = await task;
	if (result) remember(url, result);
	return result;
}

const BOT_SUFFIX = /\[bot\]$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,38})$/;

export function isBotLogin(login: string): boolean {
	return BOT_SUFFIX.test(login);
}

export function avatarUrlOf(login: string, avatars: Record<string, string> = {}, src?: string): string {
	if (isGitHubImageUrl(src)) return src as string;
	const candidates = login.endsWith("[bot]") ? [login, login.replace(BOT_SUFFIX, "")] : [login];
	for (const candidate of candidates) {
		const mapped = avatars[candidate];
		if (isGitHubImageUrl(mapped)) return mapped;
	}
	if (isBotLogin(login)) return "";
	if (!LOGIN_PATTERN.test(login)) return "";
	return `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=64`;
}
