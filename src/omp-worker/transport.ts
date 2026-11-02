import type { OmpWorkerOutbound } from "../shared/omp-worker-messages";

const write = process.stdout.write.bind(process.stdout);

// 父进程关掉管道后继续写会抛 EPIPE：这是正常退出路径，不该刷错误栈。
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") process.exit(0);
});

export function post(msg: OmpWorkerOutbound): void {
	let line: string;
	try {
		line = JSON.stringify(msg);
	} catch {
		// 事件里带不可序列化字段时不能拖垮通道，降级成一条空事件。
		line = JSON.stringify({ kind: "event", event: { type: "unserializable" } });
	}
	write(`${line}\n`);
}
