import { app } from "electron";

/**
 * 远程调试端口：设置 PI_DESKTOP_REMOTE_DEBUG_PORT 后开放 CDP 端口，
 * 可在 chrome://inspect 连接真实渲染进程（带 preload，能力与 app 内一致）。
 * 未设置该环境变量时不开端口，避免默认暴露调试入口。
 */
export function enableRemoteDebugging(): void {
	const raw = process.env.PI_DESKTOP_REMOTE_DEBUG_PORT;
	if (!raw) return;
	const port = Number.parseInt(raw, 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
	app.commandLine.appendSwitch("remote-debugging-port", String(port));
}
