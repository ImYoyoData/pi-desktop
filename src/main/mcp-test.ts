import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type McpTestOutcome = {
	ok: boolean;
	toolCount?: number;
	error?: string;
	durationMs: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "pi-desktop", version: "1.0.0" };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function stringMap(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "string") out[key] = item;
	}
	return out;
}

/** Windows 下按 PATH 补全 .cmd/.exe 后缀，让 npx 等命令可以直接 spawn。 */
function resolveCommand(command: string): string {
	if (process.platform !== "win32" || path.extname(command)) return command;
	const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
	for (const ext of [".cmd", ".exe", ".bat", ""]) {
		for (const dir of dirs) {
			const candidate = path.join(dir, `${command}${ext}`);
			if (fs.existsSync(candidate)) return candidate;
		}
	}
	return command;
}

function initializeRequest(id: number): Record<string, unknown> {
	return {
		jsonrpc: "2.0",
		id,
		method: "initialize",
		params: {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: CLIENT_INFO,
		},
	};
}

function toolsListRequest(id: number): Record<string, unknown> {
	return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

function errorMessageOf(message: Record<string, unknown>): string | null {
	if (!isRecord(message.error)) return null;
	const text = message.error.message;
	return typeof text === "string" && text ? text : "request failed";
}

/** Node 的 fetch 失败会把真实原因放在 cause（如 ECONNREFUSED）。 */
function fetchErrorMessage(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const cause = err.cause;
	const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
	if (causeText && !err.message.includes(causeText)) return `${err.message} (${causeText})`;
	return err.message;
}

function toolCountOf(result: unknown): number | undefined {
	if (!isRecord(result) || !Array.isArray(result.tools)) return undefined;
	return result.tools.length;
}

/** stdio：启动进程完成 initialize 握手，再尝试 tools/list。 */
function testStdio(entry: Record<string, unknown>, timeoutMs: number): Promise<McpTestOutcome> {
	const startedAt = Date.now();
	return new Promise((resolve) => {
		const command = typeof entry.command === "string" ? entry.command : "";
		const child = spawn(resolveCommand(command), stringList(entry.args), {
			cwd: typeof entry.cwd === "string" ? entry.cwd : undefined,
			env: { ...process.env, ...stringMap(entry.env) },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});

		let settled = false;
		let buffer = "";
		let stderrTail = "";

		function finish(outcome: Omit<McpTestOutcome, "durationMs">): void {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill();
			resolve({ ...outcome, durationMs: Date.now() - startedAt });
		}

		function send(message: Record<string, unknown>): void {
			child.stdin?.write(`${JSON.stringify(message)}\n`);
		}

		function handleMessage(message: Record<string, unknown>): void {
			const error = errorMessageOf(message);
			if (message.id === 1) {
				if (error) {
					finish({ ok: false, error });
					return;
				}
				send({ jsonrpc: "2.0", method: "notifications/initialized" });
				send(toolsListRequest(2));
				return;
			}
			if (message.id === 2) {
				// 握手已成功，工具列表失败仍视为可用。
				if (error) finish({ ok: true });
				else finish({ ok: true, toolCount: toolCountOf(message.result) });
			}
		}

		const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), timeoutMs);

		child.on("error", (err: Error) => finish({ ok: false, error: err.message }));
		child.on("close", (code) => {
			if (!settled) {
				finish({ ok: false, error: stderrTail.trim() || `exited with code ${code ?? "null"}` });
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-400);
		});
		child.stdout?.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				let message: unknown;
				try {
					message = JSON.parse(trimmed);
				} catch {
					continue;
				}
				if (isRecord(message)) handleMessage(message);
			}
		});

		send(initializeRequest(1));
	});
}

/** 响应体可能是 JSON，也可能是 SSE 事件流。 */
function parsePayload(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("{")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return isRecord(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	for (const line of trimmed.split(/\r?\n/)) {
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trim();
		if (!data) continue;
		try {
			const parsed: unknown = JSON.parse(data);
			if (isRecord(parsed)) return parsed;
		} catch {
			// 忽略无法解析的事件
		}
	}
	return null;
}

/** HTTP/SSE：对 url 发 initialize 请求，再尝试 tools/list。 */
async function testHttp(entry: Record<string, unknown>, timeoutMs: number): Promise<McpTestOutcome> {
	const startedAt = Date.now();
	const url = typeof entry.url === "string" ? entry.url : "";
	const signal = AbortSignal.timeout(timeoutMs);
	const baseHeaders: Record<string, string> = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
		...stringMap(entry.headers),
	};
	try {
		const initRes = await fetch(url, {
			method: "POST",
			headers: baseHeaders,
			body: JSON.stringify(initializeRequest(1)),
			signal,
		});
		if (!initRes.ok) {
			return { ok: false, error: `HTTP ${initRes.status}`, durationMs: Date.now() - startedAt };
		}
		const initMessage = parsePayload(await initRes.text());
		if (!initMessage) {
			return { ok: false, error: "invalid response", durationMs: Date.now() - startedAt };
		}
		const initError = errorMessageOf(initMessage);
		if (initError) {
			return { ok: false, error: initError, durationMs: Date.now() - startedAt };
		}

		const sessionId = initRes.headers.get("mcp-session-id");
		const listRes = await fetch(url, {
			method: "POST",
			headers: sessionId ? { ...baseHeaders, "mcp-session-id": sessionId } : baseHeaders,
			body: JSON.stringify(toolsListRequest(2)),
			signal,
		});
		if (!listRes.ok) {
			return { ok: true, durationMs: Date.now() - startedAt };
		}
		const listMessage = parsePayload(await listRes.text());
		return {
			ok: true,
			toolCount: listMessage ? toolCountOf(listMessage.result) : undefined,
			durationMs: Date.now() - startedAt,
		};
	} catch (err) {
		const message = fetchErrorMessage(err);
		return {
			ok: false,
			error: /abort/i.test(message) ? "timeout" : message,
			durationMs: Date.now() - startedAt,
		};
	}
}

export async function testMcpServer(
	entry: Record<string, unknown>,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<McpTestOutcome> {
	if (typeof entry.url === "string" && entry.url) return testHttp(entry, timeoutMs);
	if (typeof entry.command === "string" && entry.command) return testStdio(entry, timeoutMs);
	return { ok: false, error: "no command or url", durationMs: 0 };
}
