import type { OmpWorkerInbound } from "../shared/omp-worker-messages";
import { handleWorkerMessage } from "./runtime";
import { post } from "./transport";

// stdout 是 JSONL 协议通道，SDK 自己的日志只能走 stderr。
const logToStderr = (...args: unknown[]): void => {
	process.stderr.write(`${args.map(String).join(" ")}\n`);
};
console.log = logToStderr as typeof console.log;
console.info = logToStderr as typeof console.info;
console.debug = logToStderr as typeof console.debug;

function dispatch(line: string): void {
	let msg: OmpWorkerInbound;
	try {
		msg = JSON.parse(line) as OmpWorkerInbound;
	} catch {
		return;
	}
	if (msg.kind === "ping") {
		post({ kind: "pong" });
		return;
	}
	void handleWorkerMessage(msg).catch((err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		if (msg.kind === "command" && typeof msg.id === "string") {
			post({ kind: "result", id: msg.id, error: message });
			return;
		}
		post({ kind: "fatal", error: message });
	});
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	buffer += chunk;
	let newline = buffer.indexOf("\n");
	while (newline >= 0) {
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (line) dispatch(line);
		newline = buffer.indexOf("\n");
	}
});
