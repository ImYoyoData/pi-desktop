import { createApi } from "../../shared/api";
import type { ApiIpc, ApiListener } from "../../shared/api";
import { DEV_BRIDGE_DEFAULT_PORT } from "../../shared/dev-bridge";

declare global {
	interface Window {
		/** 外部浏览器预览模式：没有 Electron 的 webview 等原生能力。 */
		__piBrowserPreview?: boolean;
		/** 预览桥地址：主进程端口由构建时注入。 */
		__piBridgeOrigin?: string;
	}
}

/** 桥端口与实例标识由注入脚本的查询参数带上（见 electron.vite.config.ts 的 devBridgePlugin）。 */
const BRIDGE_PARAMS = new URL(import.meta.url).searchParams;

const BRIDGE_PORT = (() => {
	const raw = BRIDGE_PARAMS.get("bridgePort");
	const port = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isInteger(port) && port > 0 && port <= 65535
		? port
		: DEV_BRIDGE_DEFAULT_PORT;
})();

const BRIDGE_INSTANCE = BRIDGE_PARAMS.get("instance") ?? "";

const BRIDGE_ORIGIN = `http://127.0.0.1:${BRIDGE_PORT}`;

type PayloadListener = (payload: unknown) => void;

const FAKE_EVENT = {} as Electron.IpcRendererEvent;

const registry = new Map<string, Map<object, PayloadListener>>();

function on<T extends unknown[]>(channel: string, listener: ApiListener<T>): void {
	const map = registry.get(channel) ?? new Map<object, PayloadListener>();
	map.set(listener, (payload) => {
		(listener as unknown as (...args: unknown[]) => void)(FAKE_EVENT, payload);
	});
	registry.set(channel, map);
}

function removeListener<T extends unknown[]>(
	channel: string,
	listener: ApiListener<T>,
): void {
	registry.get(channel)?.delete(listener);
}

async function invoke(channel: string, args: unknown[]): Promise<unknown> {
	const response = await fetch(`${BRIDGE_ORIGIN}/invoke`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ channel, args }),
	});
	const payload = (await response.json()) as {
		ok: boolean;
		result?: unknown;
		error?: string;
	};
	if (!payload.ok) throw new Error(payload.error ?? "调用失败");
	return payload.result;
}

function post(channel: string, args: unknown[]): void {
	void fetch(`${BRIDGE_ORIGIN}/invoke`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ channel, args }),
	}).catch(() => undefined);
}

/** 偏好存储在渲染层启动时同步读取，这里用同步 XHR 保持同样的语义。 */
function readSync(channel: string, args: unknown[]): unknown {
	const request = new XMLHttpRequest();
	request.open("POST", `${BRIDGE_ORIGIN}/sync`, false);
	request.setRequestHeader("Content-Type", "application/json");
	request.send(JSON.stringify({ channel, args }));
	const payload = JSON.parse(request.responseText) as {
		ok: boolean;
		result?: unknown;
		error?: string;
	};
	if (!payload.ok) throw new Error(payload.error ?? "调用失败");
	return payload.result;
}

/**
 * 确认连到的是自己的主进程。
 * 连错实例时两端各连各的主进程，界面看起来「怎么都不同步」——这里直接报出来。
 */
async function verifyInstance(): Promise<void> {
	if (!BRIDGE_INSTANCE) return;
	try {
		const response = await fetch(`${BRIDGE_ORIGIN}/identity`, {
			headers: { Accept: "application/json" },
		});
		const payload = (await response.json()) as { instance?: string };
		if (payload.instance && payload.instance !== BRIDGE_INSTANCE) {
			showBridgeHint(
				`这个页面连到了另一个 Pi Desktop 实例（${payload.instance}），两边状态不会同步。请改用本页面对应的 dev 地址，或关掉多余的 dev 实例。`,
			);
		}
	} catch {
		// 连不上时由事件流错误统一提示
	}
}

function connectEvents(): void {
	const source = new EventSource(`${BRIDGE_ORIGIN}/events`);
	source.onmessage = (event) => {
		const data = JSON.parse(event.data) as {
			channel: string;
			args: unknown[];
		};
		const map = registry.get(data.channel);
		if (!map) return;
		for (const listener of map.values()) listener(data.args[0]);
	};
	source.onerror = () => showBridgeHint();
}

function showBridgeHint(message?: string): void {
	if (document.getElementById("pi-dev-bridge-hint")) return;
	const hint = document.createElement("div");
	hint.id = "pi-dev-bridge-hint";
	hint.textContent =
		message ??
		`无法连接 Pi Desktop 主进程（${BRIDGE_ORIGIN}）。请确认 npm run dev 正在运行后刷新页面。`;
	hint.style.cssText =
		"position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#b42318;color:#fff;font:13px/1.6 system-ui,sans-serif;padding:8px 12px;text-align:center";
	document.body.appendChild(hint);
}

const bridgeIpc: ApiIpc = {
	invoke: (channel, ...args) => invoke(channel, args),
	on,
	removeListener,
	send: (channel, ...args) => post(channel, args),
	sendSync: (channel, ...args) => readSync(channel, args),
};

if (!window.api) {
	window.__piBrowserPreview = true;
	window.__piBridgeOrigin = BRIDGE_ORIGIN;
	window.api = createApi(bridgeIpc, { getPathForFile: () => "" });
	connectEvents();
	void verifyInstance();
}
