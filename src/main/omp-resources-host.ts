import fs from "node:fs";
import path from "node:path";
import { ompAgentDir } from "./omp-dir";
import { ompConfigPath } from "./omp-settings-host";
import { readYamlObject, writeYamlObject } from "./omp-yaml";
import type {
	OmpResourceItem,
	OmpResourceKind,
	OmpResourceScope,
	OmpResourcesSnapshot,
} from "../shared/omp-resources";

/**
 * OMP 的资源只来自它自己的目录：用户级 ~/.omp/agent 与项目级 <root>/.omp。
 * omp 还能从 .claude/.codex 等外部目录发现资源，桌面端不列那些。
 */

const SKILL_FILE = "SKILL.md";
const EXTENSION_MANIFEST = "gemini-extension.json";

/** omp 的技能必须有 description 才被加载，缺了就标出来。 */
const MISSING_DESCRIPTION = "缺少 description，omp 不会加载这个技能";

type Dir = { dir: string; scope: OmpResourceScope };

function userDir(): Dir {
	return { dir: ompAgentDir(), scope: "user" };
}

function projectDir(root: string | undefined): Dir | null {
	if (!root?.trim()) return null;
	return { dir: path.join(path.resolve(root), ".omp"), scope: "project" };
}

function dirs(root: string | undefined): Dir[] {
	const project = projectDir(root);
	return project ? [project, userDir()] : [userDir()];
}

function isFile(target: string): boolean {
	try {
		return fs.statSync(target).isFile();
	} catch {
		return false;
	}
}

/** 软链指向目录也算目录（omp 的扩展扫描会跟进链接目录）。 */
function isDirLike(target: string): boolean {
	try {
		return fs.statSync(target).isDirectory();
	} catch {
		return false;
	}
}

function readText(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
}

/**
 * frontmatter 解析：只取顶层标量字段（name / description / enabled）。
 *
 * OMP 的 frontmatter 是标准 YAML，但它的解析器随 bun 运行时，主进程用不了；
 * 这里只读设置页需要的几个标量字段，不引第三方 YAML 依赖。
 */
function parseFrontmatter(content: string): Record<string, unknown> {
	const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(content);
	if (!match) return {};
	const fields: Record<string, unknown> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const field = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
		if (!field) continue;
		const key = field[1];
		const raw = field[2].trim();
		if (!raw || raw.startsWith("#")) continue;
		if (raw === "true") fields[key] = true;
		else if (raw === "false") fields[key] = false;
		else if (/^-?\d+(\.\d+)?$/.test(raw)) fields[key] = Number(raw);
		else fields[key] = raw.replace(/^["']|["']$/g, "");
	}
	return fields;
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

/** 技能：<dir>/skills/<name>/SKILL.md。 */
function scanSkills(list: Dir[]): OmpResourceItem[] {
	const items: OmpResourceItem[] = [];
	for (const { dir, scope } of list) {
		const skillsRoot = path.join(dir, "skills");
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const filePath = path.join(skillsRoot, entry.name, SKILL_FILE);
			if (!isFile(filePath)) continue;
			const frontmatter = parseFrontmatter(readText(filePath));
			const name = textOf(frontmatter.name) || entry.name;
			const description = textOf(frontmatter.description);
			items.push({
				id: `skills:${name}`,
				name,
				description,
				filePath,
				scope,
				kind: "skills",
				enabled: true,
				extensionId: `skill:${name}`,
				// omp 的技能必须有 description 才被加载，缺了就标出来。
				detail: description ? undefined : MISSING_DESCRIPTION,
			});
		}
	}
	return items;
}

/** 指令：<dir>/instructions/*.md。 */
function scanInstructions(list: Dir[]): OmpResourceItem[] {
	const items: OmpResourceItem[] = [];
	for (const { dir, scope } of list) {
		const instructionsRoot = path.join(dir, "instructions");
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(instructionsRoot, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const filePath = path.join(instructionsRoot, entry.name);
			const name = entry.name.replace(/\.instructions\.md$/, "").replace(/\.md$/, "");
			const body = readText(filePath);
			const frontmatter = parseFrontmatter(body);
			items.push({
				id: `instructions:${name}`,
				name: textOf(frontmatter.name) || name,
				description: firstLine(body),
				filePath,
				scope,
				kind: "instructions",
				enabled: true,
				extensionId: `instruction:${name}`,
			});
		}
	}
	return items;
}

/** 描述取正文第一行（去掉 markdown 标记）。 */
function firstLine(body: string): string {
	const line = body
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry && !entry.startsWith("#") && !entry.startsWith("---"));
	return line ? line.replace(/^[-*]\s+/, "").slice(0, 200) : "";
}

/**
 * 扩展：<dir>/extensions/ 下的两种形态——
 * 直接的 .ts/.js 文件，或带 index.ts / index.js / package.json 的子目录；
 * 子目录里还有 gemini-extension.json 清单时按清单里的名字与描述展示。
 *
 * 只有扩展模块能被 disabledExtensions 禁用（omp 的扩展 id 是
 * extension-module:<name>）；gemini 清单式扩展没有开关。
 */
function scanExtensions(list: Dir[]): OmpResourceItem[] {
	const items: OmpResourceItem[] = [];
	for (const { dir, scope } of list) {
		const extensionsRoot = path.join(dir, "extensions");
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(extensionsRoot, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(extensionsRoot, entry.name);
			let name = entry.name;
			let description = "";
			let detail = full;
			let extensionId: string | undefined;
			const isDir =
				entry.isDirectory() || (entry.isSymbolicLink() && isDirLike(full));
			if (isDir) {
				const manifestPath = path.join(full, EXTENSION_MANIFEST);
				if (isFile(manifestPath)) {
					try {
						const manifest = JSON.parse(readText(manifestPath)) as {
							name?: string;
							description?: string;
						};
						name = textOf(manifest.name) || entry.name;
						description = textOf(manifest.description);
						detail = manifestPath;
					} catch {
						// 清单坏了就按目录名展示
					}
					// gemini 清单式扩展没有 omp 侧的启停开关，不给 extensionId。
				} else {
					const moduleFile = ["index.ts", "index.js", "package.json"].find(
						(candidate) => isFile(path.join(full, candidate)),
					);
					if (!moduleFile) continue;
					detail = path.join(full, moduleFile);
					name = extensionModuleName(detail, name);
					extensionId = `extension-module:${name}`;
				}
			} else if (/\.(ts|js)$/.test(entry.name)) {
				name = entry.name.replace(/\.(ts|js)$/, "");
				extensionId = `extension-module:${name}`;
			} else {
				continue;
			}
			items.push({
				id: `extensions:${name}`,
				name,
				description,
				filePath: detail,
				scope,
				kind: "extensions",
				enabled: true,
				extensionId,
				detail,
			});
		}
	}
	return items;
}

/** omp 的扩展模块名：index.ts 取父目录名，rtk.ts 取 rtk。 */
function extensionModuleName(filePath: string, fallback: string): string {
	const base = filePath.replace(/\\/g, "/").split("/").pop() ?? fallback;
	if (base === "index.ts" || base === "index.js") {
		const parts = filePath.replace(/\\/g, "/").split("/");
		return parts[parts.length - 2] ?? fallback;
	}
	if (base === "package.json") {
		const parts = filePath.replace(/\\/g, "/").split("/");
		return parts[parts.length - 2] ?? fallback;
	}
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

/** MCP：<dir>/mcp.json 的 mcpServers。 */
function scanMcp(list: Dir[]): OmpResourceItem[] {
	const items: OmpResourceItem[] = [];
	const denied = readDisabledServers(userMcpPath());
	for (const { dir, scope } of list) {
		const filePath = path.join(dir, "mcp.json");
		if (!isFile(filePath)) continue;
		let raw: unknown;
		try {
			raw = JSON.parse(readText(filePath));
		} catch {
			continue;
		}
		const servers = (raw as { mcpServers?: Record<string, unknown> })?.mcpServers;
		if (!servers || typeof servers !== "object") continue;
		for (const [name, value] of Object.entries(servers)) {
			const entry = (value ?? {}) as {
				command?: string;
				args?: string[];
				url?: string;
				enabled?: boolean;
			};
			const detail = entry.command
				? [entry.command, ...(entry.args ?? [])].join(" ")
				: (entry.url ?? "");
			items.push({
				id: `mcp:${name}`,
				name,
				description: detail,
				filePath,
				scope,
				kind: "mcp",
				// 用户级 denylist 优先于条目上的 enabled 字段（与 omp 一致）。
				enabled: entry.enabled !== false && !denied.includes(name),
				extensionId: `mcp:${name}`,
				detail,
			});
		}
	}
	return items;
}

/** 用户级 mcp.json：omp 的禁用列表只认这一份。 */
function userMcpPath(): string {
	return path.join(ompAgentDir(), "mcp.json");
}

function readDisabledServers(filePath: string): string[] {
	try {
		const raw = JSON.parse(readText(filePath)) as {
			disabledServers?: unknown;
		};
		return Array.isArray(raw.disabledServers)
			? raw.disabledServers.filter((entry): entry is string => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

/** config.yml 里的 disabledExtensions：OMP 用它禁用技能/指令等扩展。 */
function readDisabledExtensions(): string[] {
	const doc = readYamlObject(ompConfigPath());
	const value = doc?.disabledExtensions;
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function writeDisabledExtensions(ids: string[]): void {
	const filePath = ompConfigPath();
	const doc = readYamlObject(filePath) ?? {};
	if (ids.length) doc.disabledExtensions = ids;
	else delete doc.disabledExtensions;
	writeYamlObject(filePath, doc);
}

export function listOmpResources(root?: string): OmpResourcesSnapshot {
	const list = dirs(root);
	const skills = scanSkills(list);
	const instructions = scanInstructions(list);
	const extensions = scanExtensions(list);
	const mcp = scanMcp(list);
	const disabled = new Set(readDisabledExtensions());
	// 只有带 extensionId 的条目能被 disabledExtensions 管到；其余保持原状态。
	const mark = (items: OmpResourceItem[]): OmpResourceItem[] =>
		items.map((item) =>
			item.extensionId && disabled.has(item.extensionId)
				? { ...item, enabled: false }
				: item,
		);
	return {
		skills: mark(skills),
		instructions: mark(instructions),
		extensions: mark(extensions),
		mcp,
	};
}

/** 切换一个资源的启用状态。 */
export function setOmpResourceEnabled(
	item: OmpResourceItem,
	enabled: boolean,
): void {
	if (item.kind === "mcp") {
		setMcpEnabled(item, enabled);
		return;
	}
	if (!item.extensionId) return;
	const disabled = new Set(readDisabledExtensions());
	if (enabled) disabled.delete(item.extensionId);
	else disabled.add(item.extensionId);
	writeDisabledExtensions([...disabled]);
}

/**
 * MCP 的启停写进条目所在的 mcp.json（enabled 字段）。
 *
 * 重新启用时还要清掉用户级 disabledServers 里的同名条目：那个 denylist
 * 优先于 enabled 字段，不清的话服务器仍被 omp 抑制。
 */
function setMcpEnabled(item: OmpResourceItem, enabled: boolean): void {
	const raw = readText(item.filePath);
	if (!raw) throw new Error("mcp config not found");
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		throw new Error("mcp config is not valid JSON");
	}
	const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
	const entry = (servers[item.name] ?? {}) as Record<string, unknown>;
	if (enabled) delete entry.enabled;
	else entry.enabled = false;
	servers[item.name] = entry;
	parsed.mcpServers = servers;
	fs.writeFileSync(item.filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

	if (!enabled) return;
	const userPath = userMcpPath();
	if (userPath === item.filePath) return;
	const userRaw = readText(userPath);
	if (!userRaw) return;
	try {
		const userConfig = JSON.parse(userRaw) as Record<string, unknown>;
		const denied = userConfig.disabledServers;
		if (!Array.isArray(denied) || !denied.includes(item.name)) return;
		const next = denied.filter((entry2) => entry2 !== item.name);
		if (next.length) userConfig.disabledServers = next;
		else delete userConfig.disabledServers;
		fs.writeFileSync(userPath, `${JSON.stringify(userConfig, null, 2)}\n`, "utf8");
	} catch {
		// 用户级 mcp.json 读不出来时不动它。
	}
}

export type OmpResourceKindFilter = OmpResourceKind;
