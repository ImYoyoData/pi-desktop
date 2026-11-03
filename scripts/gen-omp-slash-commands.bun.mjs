import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 从 omp SDK 导出内建斜杠命令的元数据。
 * 桌面主进程不能 import omp SDK（依赖 bun 运行时），构建期把命令清单
 * 抽成 JSON 随包分发；omp 升级后重跑本脚本即可。
 */
const root = path.resolve(import.meta.dirname, "..");
const pkgFile = (relative) =>
	pathToFileURL(path.join(root, "node_modules", relative)).href;

const { BUILTIN_SLASH_COMMANDS_INTERNAL } = await import(
	pkgFile("@oh-my-pi/pi-coding-agent/src/slash-commands/builtin-registry.ts")
);

const rows = BUILTIN_SLASH_COMMANDS_INTERNAL.map((command) => ({
	name: command.name,
	aliases: command.aliases ?? [],
	description: command.description,
	hint: command.acpInputHint ?? command.inlineHint ?? null,
	subcommands: (command.subcommands ?? []).map((entry) => ({
		name: entry.name,
		description: entry.description,
	})),
	handles: command.handle !== undefined,
}));

const outFile = path.join(root, "src", "shared", "omp-slash-commands.json");
fs.writeFileSync(outFile, `${JSON.stringify(rows, null, "\t")}\n`);
console.info(`[omp-slash] wrote ${rows.length} commands → ${outFile}`);
