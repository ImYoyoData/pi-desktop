/**
 * 观测模型 HTTP 请求本身走到了哪一步（已发出 / 已收到响应头 / 失败），
 * 让界面在「等待模型响应」期间能说清是没连上、服务端没回，还是在等首个 token。
 *
 * SDK 默认用 globalThis.fetch 发请求（ProviderOptions.fetch 缺省即此），
 * 因此在 worker 启动早期包一层即可覆盖全部 provider。
 */

type ProgressSink = (event: Record<string, unknown>) => void;

type ProgressContext = {
	sink: ProgressSink;
	/** 当前模型 baseUrl；请求发生时读取，换模型后无需重装。 */
	baseUrl: () => string | null;
};

let context: ProgressContext | null = null;
let installed = false;

export function configureLlmProgress(next: ProgressContext | null): void {
	context = next;
}

function requestUrl(input: RequestInfo | URL): URL | null {
	const raw =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input?.url;
	if (!raw) return null;
	try {
		return new URL(raw);
	} catch {
		return null;
	}
}

/** 只认模型端点，避免把 MCP / OAuth 等其它 POST 误报成模型请求。 */
function isModelRequest(url: URL, baseUrl: string): boolean {
	let base: URL;
	try {
		base = new URL(baseUrl);
	} catch {
		// 自定义 provider 常把 baseUrl 写成裸域名。
		try {
			base = new URL(`https://${baseUrl}`);
		} catch {
			return false;
		}
	}
	if (url.origin !== base.origin) return false;
	const basePath = base.pathname.replace(/\/+$/, "");
	return !basePath || url.pathname.startsWith(basePath);
}

/** 上报失败不能影响请求本身。 */
function emit(active: ProgressContext, event: Record<string, unknown>): void {
	try {
		active.sink(event);
	} catch {
		// progress is best-effort
	}
}

/**
 * 桌面端不调用 pi 的 configureHttpDispatcher，"替换 globalThis.fetch 不会被它覆盖；
 * 若将来启用该配置，它会把本包装当作 deliberate override 而跳过 undici 安装 —— 届时改走
 * ProviderOptions.fetch 注入。
 */
export function installLlmProgressProbe(): void {
	if (installed) return;
	installed = true;
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const active = context;
		let url: URL | null = null;
		let baseUrl: string | null = null;
		try {
			url = active ? requestUrl(input) : null;
			baseUrl = active?.baseUrl() ?? null;
		} catch {
			// 探针不能把可取的信息变成请求失败。
			return original(input, init);
		}
		if (!active || !url || !baseUrl || !isModelRequest(url, baseUrl)) {
			return original(input, init);
		}
		const startedAt = Date.now();
		const host = url.host;
		emit(active, { type: "llm_progress", stage: "sent", host, at: startedAt });
		try {
			const response = await original(input, init);
			emit(active, {
				type: "llm_progress",
				stage: "response",
				host,
				at: Date.now(),
				status: response.status,
				durationMs: Date.now() - startedAt,
			});
			return response;
		} catch (err) {
			emit(active, {
				type: "llm_progress",
				stage: "failed",
				host,
				at: Date.now(),
				durationMs: Date.now() - startedAt,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}) as typeof globalThis.fetch;
}
