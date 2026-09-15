import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import { resolveTrustState } from "./project-trust";
import { listPlugins } from "./plugins-host";
import type {
	CustomizationCreateKind,
	CustomizationHook,
	CustomizationItem,
	CustomizationScope,
	CustomizationsSnapshot,
} from "../shared/customizations";

type Sdk = typeof import("@earendil-works/pi-coding-agent");

type SourceInfoLike = { scope?: string; origin?: string; source?: string };

type ExtensionLike = {
	path: string;
	sourceInfo?: SourceInfoLike;
	handlers: Map<string, unknown>;
	tools: Map<string, { definition?: { label?: string; description?: string } }>;
};

/** pi 内置工具与简介，文案取自 pi-coding-agent 各工具的系统提示 snippet。 */
const BUILTIN_TOOLS: ReadonlyArray<{ name: string; description: string }> = [
	{ name: "read", description: "Read file contents" },
	{ name: "write", description: "Create or overwrite files" },
	{ name: "edit", description: "Make precise file edits with exact text replacement" },
	{ name: "bash", description: "Execute bash commands (ls, grep, find, etc.)" },
	{ name: "powershell", description: "Execute PowerShell commands" },
	{ name: "grep", description: "Search file contents for patterns (respects .gitignore)" },
	{ name: "find", description: "Find files by glob pattern (respects .gitignore)" },
	{ name: "ls", description: "List directory contents" },
];

/** 全局智能体文件（pi-subagents 同款目录）。 */
function agentDirs(root: string, dir: string): Array<[string, CustomizationScope]> {
	return [
		[path.join(dir, "agents"), "user"],
		[path.join(root, ".pi", "agents"), "project"],
		[path.join(dir, "npm", "node_modules", "pi-subagents", "agents"), "builtin"],
	];
}

function scopeOf(info: SourceInfoLike | undefined): CustomizationScope {
	if (info?.origin === "package") return "extension";
	return info?.scope === "user" ? "user" : "project";
}

function packageSource(info: SourceInfoLike | undefined): string | undefined {
	return info?.origin === "package" ? info.source : undefined;
}

function firstLine(content: string): string {
	const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
	const line = body.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? "";
	return line.trim().slice(0, 160);
}

function formatTools(value: unknown): string | undefined {
	if (Array.isArray(value)) {
		const tools = value.filter((entry): entry is string => typeof entry === "string");
		return tools.length ? tools.join(", ") : undefined;
	}
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readAgentDir(directory: string, scope: CustomizationScope, sdk: Sdk): CustomizationItem[] {
	if (!fs.existsSync(directory)) return [];
	return fs
		.readdirSync(directory)
		.filter((name) => name.endsWith(".md"))
		.map((name) => {
			const filePath = path.join(directory, name);
			const content = fs.readFileSync(filePath, "utf8");
			const { frontmatter } = sdk.parseFrontmatter<Record<string, unknown>>(content);
			return {
				id: filePath,
				name:
					typeof frontmatter.name === "string" && frontmatter.name.trim()
						? frontmatter.name
						: name.replace(/\.md$/, ""),
				description:
					typeof frontmatter.description === "string"
						? frontmatter.description
						: firstLine(content),
				filePath,
				scope,
				detail: formatTools(frontmatter.tools),
			};
		});
}

function listAgents(root: string, dir: string, sdk: Sdk): CustomizationItem[] {
	return agentDirs(root, dir).flatMap(([directory, scope]) =>
		readAgentDir(directory, scope, sdk),
	);
}

function describeMcp(entry: unknown): string {
	if (!entry || typeof entry !== "object") return "";
	const record = entry as { command?: unknown; args?: unknown; url?: unknown };
	if (typeof record.url === "string" && record.url) return record.url;
	const command = typeof record.command === "string" ? record.command : "";
	const args = Array.isArray(record.args)
		? record.args.filter((arg): arg is string => typeof arg === "string")
		: [];
	return [command, ...args].join(" ").trim();
}

function readMcpFile(file: string, scope: CustomizationScope): CustomizationItem[] {
	if (!fs.existsSync(file)) return [];
	let parsed: { mcpServers?: Record<string, unknown> };
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf8")) as typeof parsed;
	} catch {
		return [];
	}
	const servers = parsed.mcpServers;
	if (!servers || typeof servers !== "object") return [];
	return Object.entries(servers).map(([name, entry]) => ({
		id: `${file}#${name}`,
		name,
		description: describeMcp(entry),
		filePath: file,
		scope,
	}));
}

function extensionLabel(ext: ExtensionLike): string {
	const source = ext.sourceInfo?.source;
	if (source && source !== "path" && source !== "top-level") return source;
	return path.basename(ext.path).replace(/\.[a-z]+$/i, "");
}

function collectHooks(extensions: readonly ExtensionLike[]): CustomizationHook[] {
	const byEvent = new Map<string, string[]>();
	for (const ext of extensions) {
		const label = extensionLabel(ext);
		for (const event of ext.handlers.keys()) {
			const list = byEvent.get(event) ?? [];
			if (!list.includes(label)) list.push(label);
			byEvent.set(event, list);
		}
	}
	return [...byEvent.entries()]
		.map(([event, subscribers]) => ({ event, subscribers }))
		.sort((a, b) => a.event.localeCompare(b.event));
}

function collectTools(extensions: readonly ExtensionLike[]): CustomizationItem[] {
	const items: CustomizationItem[] = BUILTIN_TOOLS.map((tool) => ({
		id: `builtin:${tool.name}`,
		name: tool.name,
		description: tool.description,
		scope: "builtin",
	}));
	for (const ext of extensions) {
		const label = extensionLabel(ext);
		for (const [name, tool] of ext.tools) {
			items.push({
				id: `extension:${label}:${name}`,
				name,
				description: tool.definition?.description ?? "",
				scope: "extension",
				source: label,
			});
		}
	}
	return items;
}

async function listPluginItems(root: string): Promise<CustomizationItem[]> {
	const { packages } = await listPlugins(root);
	return packages.map((entry) => ({
		id: `${entry.scope}:${entry.source}`,
		name: entry.source,
		description: entry.installedPath ?? entry.source,
		scope: entry.scope === "project" ? "project" : "user",
		source: entry.source,
		detail: entry.status,
		enabled: !entry.disabled,
	}));
}

export async function listCustomizations(root: string): Promise<CustomizationsSnapshot> {
	const sdk = await import("@earendil-works/pi-coding-agent");
	const dir = sdk.getAgentDir();
	const settingsManager = sdk.SettingsManager.create(root, dir, {
		projectTrusted: resolveTrustState(root, dir).projectTrusted,
	});
	const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: dir, settingsManager });
	await loader.reload();

	const skills = loader.getSkills();
	const prompts = loader.getPrompts();
	const extensions = loader.getExtensions();
	const agentsFiles = loader.getAgentsFiles().agentsFiles;
	const extensionList: ExtensionLike[] = extensions.extensions;

	return {
		root,
		agents: listAgents(root, dir, sdk),
		skills: skills.skills.map((skill) => ({
			id: skill.filePath,
			name: skill.name,
			description: skill.description,
			filePath: skill.filePath,
			scope: scopeOf(skill.sourceInfo),
			source: packageSource(skill.sourceInfo),
			enabled: !skill.disableModelInvocation,
		})),
		instructions: agentsFiles.map((file) => ({
			id: file.path,
			name: path.basename(file.path),
			description: firstLine(file.content),
			filePath: file.path,
			scope: path.resolve(file.path).toLowerCase().startsWith(path.resolve(root).toLowerCase())
				? "project"
				: "user",
		})),
		prompts: prompts.prompts.map((prompt) => ({
			id: prompt.filePath,
			name: prompt.name,
			description: prompt.description,
			filePath: prompt.filePath,
			scope: scopeOf(prompt.sourceInfo),
			source: packageSource(prompt.sourceInfo),
			detail: prompt.argumentHint,
		})),
		hooks: collectHooks(extensionList),
		mcp: [
			...readMcpFile(path.join(dir, "mcp.json"), "user"),
			...readMcpFile(path.join(root, ".pi", "mcp.json"), "project"),
		],
		plugins: await listPluginItems(root),
		tools: collectTools(extensionList),
		diagnostics: [
			...skills.diagnostics.map((entry) => entry.message),
			...prompts.diagnostics.map((entry) => entry.message),
			...extensions.errors.map((entry) => `${path.basename(entry.path)}: ${entry.error}`),
		],
	};
}

type CreateTemplate = {
	base: string;
	relative: (name: string) => string;
	content: (name: string) => string;
};

/** 新建定制项的用户级目录与模板（对应 pi 的 agentDir 约定）。 */
const CREATE_TEMPLATES: Record<CustomizationCreateKind, CreateTemplate> = {
	agents: {
		base: "new-agent",
		relative: (name) => path.join("agents", `${name}.md`),
		content: () =>
			"---\ndescription: Describe when to use this agent.\n---\n\n# New Agent\n\nDescribe the persona, tool access and instructions for this agent.\n",
	},
	skills: {
		base: "new-skill",
		relative: (name) => path.join("skills", name, "SKILL.md"),
		content: (name) =>
			`---\nname: ${name}\ndescription: Describe what this skill does and when to use it.\n---\n\n# New Skill\n\nWrite the skill instructions here.\n`,
	},
	instructions: {
		base: "AGENTS",
		relative: () => "AGENTS.md",
		content: () =>
			"# Instructions\n\nAlways-on instructions that guide the agent in every session.\n",
	},
	prompts: {
		base: "new-prompt",
		relative: (name) => path.join("prompts", `${name}.md`),
		content: () =>
			"---\ndescription: Describe what this prompt does.\n---\n\nWrite the prompt template here. Use $ARGUMENTS for all arguments and $1, $2 for positional ones.\n",
	},
};

function availableName(base: string, exists: (name: string) => boolean): string {
	if (!exists(base)) return base;
	for (let index = 2; index <= 999; index += 1) {
		const candidate = `${base}-${index}`;
		if (!exists(candidate)) return candidate;
	}
	throw new Error(`No available name for ${base}`);
}

/** 在用户目录创建模板文件，返回供编辑器打开的路径。 */
export function createCustomization(kind: CustomizationCreateKind): { filePath: string } {
	const dir = agentDir();
	const template = CREATE_TEMPLATES[kind];
	if (kind === "instructions") {
		const filePath = path.join(dir, template.relative(""));
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, template.content(""), "utf8");
		}
		return { filePath };
	}
	const name = availableName(template.base, (candidate) =>
		fs.existsSync(path.join(dir, template.relative(candidate))),
	);
	const filePath = path.join(dir, template.relative(name));
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, template.content(name), "utf8");
	return { filePath };
}
