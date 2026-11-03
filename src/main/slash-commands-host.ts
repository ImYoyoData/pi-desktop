import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { load as loadYaml } from "js-yaml";
import type { ExternalSlashCommand, SlashCatalog } from "../shared/slash-commands";
import { OMP_SETTINGS, ompEffectiveValue } from "../shared/omp-settings";
import { frontmatterText } from "./frontmatter";
import { readOmpSettings } from "./omp-settings-host";

type CommandSource = ExternalSlashCommand["source"];

type CommandRoot = {
	dir: string;
	source: CommandSource;
	setting: string;
};

type CommandFile = {
	name: string;
	filePath: string;
	source: CommandSource;
};

function commandRoots(cwd: string | null): CommandRoot[] {
	const claudeUser = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude");
	const roots: CommandRoot[] = [];
	if (cwd) {
		roots.push(
			{
				dir: path.join(cwd, ".claude", "commands"),
				source: "claude-project",
				setting: "commands.enableClaudeProject",
			},
			{
				dir: path.join(cwd, ".opencode", "commands"),
				source: "opencode-project",
				setting: "commands.enableOpencodeProject",
			},
		);
	}
	roots.push(
		{
			dir: path.join(claudeUser, "commands"),
			source: "claude-user",
			setting: "commands.enableClaudeUser",
		},
		{
			dir: path.join(homedir(), ".config", "opencode", "commands"),
			source: "opencode-user",
			setting: "commands.enableOpencodeUser",
		},
	);
	return roots;
}

function settingEnabled(id: string, values: Record<string, unknown>): boolean {
	const entry = OMP_SETTINGS.find((item) => item.id === id);
	return entry ? ompEffectiveValue(entry, values) === true : false;
}

/** 递归收集 markdown 命令；子目录用冒号组成命名空间。 */
function collectCommandFiles(
	dir: string,
	prefix: string,
	source: CommandSource,
	out: CommandFile[],
	visited: Set<string>,
): void {
	let real: string;
	try {
		real = fs.realpathSync(dir);
	} catch {
		return;
	}
	if (visited.has(real)) return;
	visited.add(real);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const full = path.join(dir, entry.name);
		let isDirectory = entry.isDirectory();
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			try {
				const stat = fs.statSync(full);
				isDirectory = stat.isDirectory();
				isFile = stat.isFile();
			} catch {
				continue;
			}
		}
		if (isDirectory) {
			collectCommandFiles(
				full,
				prefix ? `${prefix}:${entry.name}` : entry.name,
				source,
				out,
				visited,
			);
		} else if (isFile && entry.name.toLowerCase().endsWith(".md")) {
			const base = entry.name.slice(0, -3);
			out.push({
				name: prefix ? `${prefix}:${base}` : base,
				filePath: full,
				source,
			});
		}
	}
}

function splitFrontmatter(content: string): {
	fields: Record<string, unknown>;
	body: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	if (!match) return { fields: {}, body: content };
	let fields: Record<string, unknown> = {};
	try {
		const parsed = loadYaml(match[1] ?? "");
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			fields = parsed as Record<string, unknown>;
		}
	} catch {
		fields = {};
	}
	return { fields, body: content.slice(match[0].length) };
}

function descriptionOf(
	fields: Record<string, unknown>,
	body: string,
): string {
	const declared = frontmatterText(fields.description);
	if (declared) return declared;
	const first = body.split(/\r?\n/).find((line) => line.trim());
	if (!first) return "";
	const text = first.trim();
	return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

function readCommand(file: CommandFile): ExternalSlashCommand | null {
	let content = "";
	try {
		content = fs.readFileSync(file.filePath, "utf8");
	} catch {
		return null;
	}
	const { fields, body } = splitFrontmatter(content);
	const declaredName = frontmatterText(fields.name);
	const name =
		file.source.startsWith("opencode") && declaredName
			? declaredName
			: file.name;
	const argumentHint =
		frontmatterText(fields["argument-hint"]) ||
		frontmatterText(fields.argumentHint);
	return {
		name,
		description: descriptionOf(fields, body),
		...(argumentHint ? { argumentHint } : {}),
		content: body,
		source: file.source,
		filePath: file.filePath,
	};
}

/** 按 omp 的命令目录开关收集桌面可用的文件型命令。 */
export function readSlashCatalog(cwd: string | null): SlashCatalog {
	const values = readOmpSettings().values;
	const files: CommandFile[] = [];
	const seenRoots = new Set<string>();
	const visited = new Set<string>();
	for (const root of commandRoots(cwd)) {
		if (!settingEnabled(root.setting, values)) continue;
		const key = path.resolve(root.dir).toLowerCase();
		if (seenRoots.has(key)) continue;
		seenRoots.add(key);
		collectCommandFiles(root.dir, "", root.source, files, visited);
	}

	const commands = new Map<string, ExternalSlashCommand>();
	for (const file of files) {
		if (commands.has(file.name) || /\s/.test(file.name.trim()) || !file.name.trim()) {
			continue;
		}
		const command = readCommand(file);
		if (
			command &&
			!commands.has(command.name) &&
			/\S/.test(command.name) &&
			!/\s/.test(command.name)
		) {
			commands.set(command.name, command);
		}
	}

	return {
		skillCommands: settingEnabled("skills.enableSkillCommands", values),
		commands: [...commands.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		),
	};
}
