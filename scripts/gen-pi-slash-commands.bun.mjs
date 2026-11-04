import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 从 pi SDK 导出内建斜杠命令的元数据。
 * 桌面主进程不能 import pi SDK 的 TUI 实现，构建期把命令清单
 * 抽成 JSON 随包分发；pi 升级后重跑本脚本即可。
 */
const root = path.resolve(import.meta.dirname, "..");
const file = pathToFileURL(
	path.join(
		root,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"core",
		"slash-commands.js",
	),
).href;

const { BUILTIN_SLASH_COMMANDS } = await import(file);

const rows = BUILTIN_SLASH_COMMANDS.map((command) => ({
	name: command.name,
	description: command.description,
	hint: command.argumentHint ?? null,
}));

const outFile = path.join(root, "src", "shared", "pi-slash-commands.json");
fs.writeFileSync(outFile, `${JSON.stringify(rows, null, "\t")}\n`);
console.info(`[pi-slash] wrote ${rows.length} commands → ${outFile}`);
