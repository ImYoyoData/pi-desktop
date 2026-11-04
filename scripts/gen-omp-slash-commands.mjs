import { execFileSync } from "node:child_process";
import path from "node:path";
import { bunBinary } from "./bun-binary.mjs";

const root = path.resolve(import.meta.dirname, "..");

/**
 * 从 omp SDK 导出内建斜杠命令的元数据。
 * 桌面主进程不能 import omp SDK（依赖 bun 运行时），构建期把命令清单
 * 抽成 JSON 随包分发；omp 升级后重跑本脚本即可。
 */
console.info("[omp-slash] generating command catalog…");
execFileSync(
	bunBinary(),
	[path.join(root, "scripts", "gen-omp-slash-commands.bun.mjs")],
	{ cwd: root, stdio: "inherit" },
);
