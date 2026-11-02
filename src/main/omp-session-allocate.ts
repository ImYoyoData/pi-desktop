import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { encodeCwdSessionDir } from "./session-list";
import { ompAgentDir } from "./omp-dir";

/**
 * 在 omp 的会话目录里写一个空会话文件，供 omp worker 打开。
 *
 * 主进程不加载 omp SDK（它依赖 bun 运行时），因此这里按 omp 的落盘格式
 * 手写 header：version 3 + `sessions/--cwd--/<iso>_<uuid>.jsonl`。
 * shortcut: 只写 header 行，omp 的 title slot 由 worker 首次落盘时补上。
 */
export async function allocateOmpSessionOnDisk(cwd: string): Promise<{
	id: string;
	cwd: string;
	filePath: string;
}> {
	const resolvedCwd = path.resolve(cwd);
	const dir = encodeCwdSessionDir(resolvedCwd, ompAgentDir());
	const id = randomUUID();
	const timestamp = new Date().toISOString();
	const fileName = `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`;
	const filePath = path.join(dir, fileName);
	await fs.promises.mkdir(dir, { recursive: true });
	const header = {
		type: "session",
		version: 3,
		id,
		timestamp,
		cwd: resolvedCwd,
	};
	await fs.promises.writeFile(filePath, `${JSON.stringify(header)}\n`, "utf8");
	return { id, cwd: resolvedCwd, filePath };
}
