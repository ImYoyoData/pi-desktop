import { execFileSync } from "node:child_process";
import path from "node:path";
import { bunBinary } from "./bun-binary.mjs";

const root = path.resolve(import.meta.dirname, "..");

/**
 * 从 pi SDK 导出内建斜杠命令的元数据。
 * 桌面主进程不能 import pi SDK 的 TUI 实现，构建期把命令清单
 * 抽成 JSON 随包分发；pi 升级后重跑本脚本即可。
 */
console.info("[pi-slash] generating command catalog…");
execFileSync(
	bunBinary(),
	[path.join(root, "scripts", "gen-pi-slash-commands.bun.mjs")],
	{ cwd: root, stdio: "inherit" },
);
