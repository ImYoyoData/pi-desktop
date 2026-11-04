import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 从 omp SDK 导出内建与随包自定义斜杠命令的元数据。
 * 桌面主进程不能 import omp SDK（依赖 bun 运行时），构建期把命令清单
 * 抽成 JSON 随包分发；omp 升级后重跑本脚本即可。
 */
const root = path.resolve(import.meta.dirname, "..");
const pkgFile = (relative) =>
	pathToFileURL(path.join(root, "node_modules", relative)).href;

const { BUILTIN_SLASH_COMMANDS_INTERNAL } = await import(
	pkgFile("@oh-my-pi/pi-coding-agent/src/slash-commands/builtin-registry.ts")
);
const { GreenCommand } = await import(
	pkgFile(
		"@oh-my-pi/pi-coding-agent/src/extensibility/custom-commands/bundled/ci-green/index.ts",
	)
);
const { ReviewCommand } = await import(
	pkgFile(
		"@oh-my-pi/pi-coding-agent/src/extensibility/custom-commands/bundled/review/index.ts",
	)
);
const { AnnotateCommand } = await import(
	pkgFile(
		"@oh-my-pi/pi-coding-agent/src/extensibility/custom-commands/bundled/annotate/index.ts",
	)
);

const commandApi = {
	cwd: root,
	exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	typebox: {},
	arktype: {},
	zod: {},
	pi: undefined,
};

const customRows = [
	new GreenCommand(commandApi),
	new ReviewCommand(commandApi),
	new AnnotateCommand(commandApi),
].map((command) => ({
	name: command.name,
	aliases: [],
	description: command.description ?? "",
	hint: null,
	subcommands: [],
	handles: false,
	source: "custom",
}));

const rows = [
	...BUILTIN_SLASH_COMMANDS_INTERNAL.map((command) => ({
		name: command.name,
		aliases: command.aliases ?? [],
		description: command.description,
		hint: command.acpInputHint ?? command.inlineHint ?? null,
		subcommands: (command.subcommands ?? []).map((entry) => ({
			name: entry.name,
			description: entry.description,
		})),
		handles: command.handle !== undefined,
		source: "builtin",
	})),
	...customRows,
];

const outFile = path.join(root, "src", "shared", "omp-slash-commands.json");
fs.writeFileSync(outFile, `${JSON.stringify(rows, null, "\t")}\n`);
console.info(`[omp-slash] wrote ${rows.length} commands → ${outFile}`);
