import fs from "node:fs";
import path from "node:path";
import { agentDir } from "./agent-dir";
import { frontmatterText } from "./frontmatter";
import { isPathInsideRoot } from "../shared/path-sandbox";
import { listPlugins } from "./plugins-host";
import { scanUnloadedSkills, type LocalSkillScope } from "./skill-scan";
import { skillWarningOf } from "./skill-validate";
import type {
	CustomizationCreateKind,
	CustomizationItem,
	CustomizationScope,
	CustomizationsSnapshot,
} from "../shared/customizations";

type Sdk = typeof import("@earendil-works/pi-coding-agent");

type SourceInfoLike = { scope?: string; origin?: string; source?: string };

/** 禁用标记后缀：`foo.md` → `foo.md.disabled`（pi 只加载 .md，禁用后不再生效）。 */
const DISABLED_EXT = ".disabled";

type PromptLike = {
	name: string;
	description: string;
	argumentHint?: string;
	filePath: string;
	sourceInfo?: SourceInfoLike;
};

type ExtensionLike = {
	path: string;
	sourceInfo?: SourceInfoLike;
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

/** Pi Desktop 自身注入的工具与简介，文案取自 agent-worker 各工具定义的 promptSnippet。 */
const DESKTOP_TOOLS: ReadonlyArray<{ name: string; description: string }> = [
	{ name: "ask_user", description: "Ask the user structured single/multi/button questions and wait for all answers" },
	{ name: "todo_write", description: "Maintain a visible todo checklist that fully replaces on every call" },
	{ name: "browser_tabs", description: "List built-in browser tabs" },
	{ name: "browser_open_tab", description: "Open a new built-in browser tab" },
	{ name: "browser_close_tab", description: "Close a built-in browser tab" },
	{ name: "browser_navigate", description: "Navigate the built-in browser" },
	{ name: "browser_back", description: "Browser history back" },
	{ name: "browser_forward", description: "Browser history forward" },
	{ name: "browser_reload", description: "Reload built-in browser" },
	{ name: "browser_url", description: "Get built-in browser URL/title" },
	{ name: "browser_snapshot", description: "Snapshot interactive DOM elements" },
	{ name: "browser_find", description: "Find elements by text, id, role, css, etc." },
	{ name: "browser_query", description: "Query DOM via CSS selector" },
	{ name: "browser_click", description: "Click a DOM element (flexible locator)" },
	{ name: "browser_hover", description: "Hover a DOM element" },
	{ name: "browser_type", description: "Type into a DOM element" },
	{ name: "browser_fill", description: "Fill a form field" },
	{ name: "browser_press", description: "Press a key in the built-in browser" },
	{ name: "browser_select", description: "Select a dropdown option" },
	{ name: "browser_check", description: "Toggle checkbox/radio" },
	{ name: "browser_scroll", description: "Scroll the built-in browser" },
	{ name: "browser_wait_for", description: "Wait for a DOM element" },
	{ name: "browser_get_text", description: "Read text from the built-in browser" },
	{ name: "browser_get_html", description: "Read HTML from the built-in browser" },
	{ name: "browser_get_attribute", description: "Read a DOM attribute" },
	{ name: "browser_get_value", description: "Read input value" },
	{ name: "browser_evaluate", description: "Evaluate JS in the built-in browser" },
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

function isDisabledFile(name: string): boolean {
	return name.endsWith(DISABLED_EXT);
}

/** 定制文件名去掉 `.md.disabled` 或 `.md` 后的基名。 */
function baseNameWithoutExtension(name: string): string {
	const base = isDisabledFile(name) ? name.slice(0, -DISABLED_EXT.length) : name;
	return base.replace(/\.md$/, "");
}

function isCustomizationFile(name: string): boolean {
	return name.endsWith(".md") || name.endsWith(`.md${DISABLED_EXT}`);
}

function readAgentDir(directory: string, scope: CustomizationScope, sdk: Sdk): CustomizationItem[] {
	if (!fs.existsSync(directory)) return [];
	return fs
		.readdirSync(directory)
		.filter(isCustomizationFile)
		.map((name) => {
			const filePath = path.join(directory, name);
			const content = fs.readFileSync(filePath, "utf8");
			const { frontmatter } = sdk.parseFrontmatter<Record<string, unknown>>(content);
			return {
				id: filePath,
				name: frontmatterText(frontmatter.name) || baseNameWithoutExtension(name),
				description: filePath,
				filePath,
				scope,
				detail: formatTools(frontmatter.tools),
				enabled: !isDisabledFile(name),
			};
		});
}

/** 已禁用的提示模板：loader 不会加载它们，需要单独扫描目录补齐列表。 */
function readDisabledPromptDir(
	directory: string,
	scope: CustomizationScope,
	sdk: Sdk,
): CustomizationItem[] {
	if (!fs.existsSync(directory)) return [];
	return fs
		.readdirSync(directory)
		.filter(isDisabledFile)
		.map((name) => {
			const filePath = path.join(directory, name);
			const content = fs.readFileSync(filePath, "utf8");
			const { frontmatter } = sdk.parseFrontmatter<Record<string, unknown>>(content);
			return {
				id: filePath,
				name: baseNameWithoutExtension(name),
				description: frontmatterText(frontmatter.description) || firstLine(content),
				filePath,
				scope,
				detail:
					typeof frontmatter["argument-hint"] === "string"
						? frontmatter["argument-hint"]
						: undefined,
				enabled: false,
			};
		});
}

function listPrompts(
	root: string,
	dir: string,
	sdk: Sdk,
	prompts: readonly PromptLike[],
): CustomizationItem[] {
	return [
		...prompts.map((prompt) => ({
			id: prompt.filePath,
			name: prompt.name,
			description: prompt.description,
			filePath: prompt.filePath,
			scope: scopeOf(prompt.sourceInfo),
			source: packageSource(prompt.sourceInfo),
			detail: prompt.argumentHint,
			enabled: true,
		})),
		...readDisabledPromptDir(path.join(dir, "prompts"), "user", sdk),
		...readDisabledPromptDir(path.join(root, ".pi", "prompts"), "project", sdk),
	];
}

function listAgents(root: string, dir: string, sdk: Sdk): CustomizationItem[] {
	return agentDirs(root, dir).flatMap(([directory, scope]) =>
		readAgentDir(directory, scope, sdk),
	);
}

/** 其它最近工作区的智能体文件。 */
function otherWorkspaceAgents(
	root: string,
	workspaces: readonly string[],
	sdk: Sdk,
): CustomizationItem[] {
	const items: CustomizationItem[] = [];
	const seen = new Set<string>();
	for (const workspace of workspaces) {
		const ws = path.resolve(workspace);
		if (ws.toLowerCase() === path.resolve(root).toLowerCase()) continue;
		for (const item of readAgentDir(path.join(ws, ".pi", "agents"), "project", sdk)) {
			const key = path.resolve(item.filePath ?? "").toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			items.push(item);
		}
	}
	return items;
}

/** 其它最近工作区的技能文件。 */
function otherWorkspaceSkillItems(
	root: string,
	workspaces: readonly string[],
	dir: string,
	loaded: ReadonlySet<string>,
	sdk: Sdk,
): CustomizationItem[] {
	const items: CustomizationItem[] = [];
	const seen = new Set<string>();
	for (const workspace of workspaces) {
		const ws = path.resolve(workspace);
		if (ws.toLowerCase() === path.resolve(root).toLowerCase()) continue;
		for (const entry of scanUnloadedSkills(ws, dir, loaded)) {
			if (entry.scope !== "project") continue;
			const key = path.resolve(entry.filePath).toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			const item = unloadedSkillItem(entry.filePath, entry.scope, sdk);
			if (item) items.push(item);
		}
	}
	return items;
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

function isMcpDisabled(entry: unknown): boolean {
	return (
		Boolean(entry) &&
		typeof entry === "object" &&
		(entry as { disabled?: unknown }).disabled === true
	);
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
		enabled: !isMcpDisabled(entry),
	}));
}

/** MCP 配置只读写用户级或工作区级的 pi 配置文件。 */
function mcpConfigPath(scope: "user" | "project", root?: string): string {
	if (scope === "user") return path.join(agentDir(), "mcp.json");
	if (root) return path.join(root, ".pi", "mcp.json");
	throw new Error("MCP servers can only be edited in the user or workspace config");
}

function readMcpRaw(file: string): Record<string, unknown> {
	if (!fs.existsSync(file)) return {};
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
	} catch {
		throw new Error(`Cannot read MCP config ${file}`);
	}
}

function writeMcpRaw(file: string, raw: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

function mcpServersObject(raw: Record<string, unknown>): Record<string, unknown> {
	const servers = raw.mcpServers;
	return servers && typeof servers === "object" && !Array.isArray(servers)
		? (servers as Record<string, unknown>)
		: {};
}

function isMcpEntry(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 通过 `disabled` 字段启停 MCP 服务器（pi-mcp-adapter 读取该字段）。 */
export function setMcpServerEnabled(
	name: string,
	scope: "user" | "project",
	enabled: boolean,
	root?: string,
): void {
	const file = mcpConfigPath(scope, root);
	const raw = readMcpRaw(file);
	const entry = mcpServersObject(raw)[name];
	if (!isMcpEntry(entry)) {
		throw new Error(`MCP server "${name}" not found in ${file}`);
	}
	if (enabled) delete entry.disabled;
	else entry.disabled = true;
	writeMcpRaw(file, raw);
}

/** 添加/覆盖 MCP 服务器定义，同名直接覆盖。 */
export function addMcpServers(
	scope: "user" | "project",
	servers: Record<string, unknown>,
	root?: string,
): { filePath: string; names: string[] } {
	const names = Object.keys(servers);
	if (names.length === 0) throw new Error("No MCP servers to add");
	for (const name of names) {
		if (!isMcpEntry(servers[name])) throw new Error(`Invalid MCP server "${name}"`);
	}
	const file = mcpConfigPath(scope, root);
	const raw = readMcpRaw(file);
	raw.mcpServers = { ...mcpServersObject(raw), ...servers };
	writeMcpRaw(file, raw);
	return { filePath: file, names };
}

/** 读取指定配置文件中某个 MCP 服务器的定义。 */
export function readMcpEntry(
	name: string,
	scope: "user" | "project",
	root?: string,
): Record<string, unknown> | null {
	try {
		const raw = readMcpRaw(mcpConfigPath(scope, root));
		const entry = mcpServersObject(raw)[name];
		return isMcpEntry(entry) ? entry : null;
	} catch {
		return null;
	}
}

/** 从配置文件中删除 MCP 服务器。 */
export function removeMcpServer(
	name: string,
	scope: "user" | "project",
	root?: string,
): { filePath: string } {
	const file = mcpConfigPath(scope, root);
	const raw = readMcpRaw(file);
	const servers = mcpServersObject(raw);
	if (!isMcpEntry(servers[name])) {
		throw new Error(`MCP server "${name}" not found in ${file}`);
	}
	delete servers[name];
	raw.mcpServers = servers;
	writeMcpRaw(file, raw);
	return { filePath: file };
}

/** 确保 MCP 配置文件可用于手动编辑，不存在时写入空骨架。 */
export function ensureMcpConfig(scope: "user" | "project", root?: string): { filePath: string } {
	const file = mcpConfigPath(scope, root);
	if (!fs.existsSync(file)) writeMcpRaw(file, { mcpServers: {} });
	return { filePath: file };
}

function extensionLabel(ext: ExtensionLike): string {
	const source = ext.sourceInfo?.source;
	if (source?.startsWith("npm:")) return source;
	const file = path.basename(ext.path).replace(/\.[a-z]+$/i, "");
	return file || source || "extension";
}

function toolItems(
	scope: "builtin" | "desktop",
	tools: ReadonlyArray<{ name: string; description: string }>,
): CustomizationItem[] {
	return tools.map((tool) => ({
		id: `${scope}:${tool.name}`,
		name: tool.name,
		description: tool.description,
		scope,
	}));
}

function collectTools(extensions: readonly ExtensionLike[]): CustomizationItem[] {
	const items: CustomizationItem[] = [
		...toolItems("builtin", BUILTIN_TOOLS),
		...toolItems("desktop", DESKTOP_TOOLS),
	];
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
		filePath: entry.installedPath,
		scope: entry.scope === "project" ? "project" : "user",
		source: entry.source,
		detail: entry.status,
		enabled: !entry.disabled,
	}));
}

/** 未被 pi 加载的本地技能条目：名称与描述按 frontmatter、正文回退，保证设置页可见可编辑。 */
function unloadedSkillItem(
	filePath: string,
	scope: LocalSkillScope,
	sdk: Sdk,
): CustomizationItem | null {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
	let frontmatter: Record<string, unknown> = {};
	try {
		frontmatter = sdk.parseFrontmatter<Record<string, unknown>>(content).frontmatter ?? {};
	} catch {
		// YAML 解析失败时按无 frontmatter 处理
	}
	const isDeclared = path.basename(filePath).toLowerCase() === "skill.md";
	const description = frontmatterText(frontmatter.description);
	// pi 对非 SKILL.md 文件要求 description，否则不会当作技能
	if (!isDeclared && !description) return null;
	const fallback = isDeclared
		? path.basename(path.dirname(filePath))
		: path.basename(filePath, path.extname(filePath));
	const name = frontmatterText(frontmatter.name) || fallback;
	return {
		id: filePath,
		name,
		description: filePath,
		filePath,
		scope,
		enabled: frontmatter["disable-model-invocation"] !== true,
		warning: skillWarningOf(name, description),
	};
}

/** pi 查找工作区指令文件的候选名与优先级。 */
const CONTEXT_FILE_NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

function contextFilePath(dir: string): string | null {
	for (const name of CONTEXT_FILE_NAMES) {
		const filePath = path.join(dir, name);
		try {
			if (fs.statSync(filePath).isFile()) return filePath;
		} catch {
			// 文件不存在时继续尝试下一个候选名
		}
	}
	return null;
}

function isInstructionFile(filePath: string): boolean {
	const name = path.basename(filePath).toLowerCase();
	return CONTEXT_FILE_NAMES.some((candidate) => candidate.toLowerCase() === name);
}

/** 删除时仅允许全局 agentDir 或已知工作区根目录下的指令文件。 */
function removableInstructionPath(
	filePath: string,
	root: string | undefined,
	workspaces: readonly string[],
): string | null {
	if (!isInstructionFile(filePath)) return null;
	const target = path.resolve(filePath);
	const dir = path.dirname(target).toLowerCase();
	const bases = [
		path.resolve(agentDir()),
		...(root ? [path.resolve(root)] : []),
		...workspaces.map((entry) => path.resolve(entry)),
	];
	return bases.some((base) => base.toLowerCase() === dir) ? target : null;
}

function isWorkspaceRootFile(filePath: string, workspaces: readonly string[]): boolean {
	const dir = path.dirname(path.resolve(filePath)).toLowerCase();
	return workspaces.some((entry) => path.resolve(entry).toLowerCase() === dir);
}

/** 工作区条目用所在目录名做标题，盘根等无名情况回退到完整路径。 */
function workspaceTitle(filePath: string): string {
	const dir = path.dirname(path.resolve(filePath));
	return path.basename(dir) || dir;
}

/** 其它最近工作区里的指令文件；skipPaths 用于跳过 pi 已加载的文件。 */
function workspaceInstructionItems(
	workspaces: readonly string[],
	skipPaths: ReadonlySet<string>,
): CustomizationItem[] {
	const items: CustomizationItem[] = [];
	const seen = new Set(skipPaths);
	for (const workspace of workspaces) {
		const filePath = contextFilePath(path.resolve(workspace));
		if (!filePath) continue;
		const key = path.resolve(filePath).toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({
			id: filePath,
			name: workspaceTitle(filePath),
			description: filePath,
			filePath,
			scope: "project",
			removable: true,
		});
	}
	return items;
}

export async function listCustomizations(
	root: string,
	workspaces: readonly string[] = [],
): Promise<CustomizationsSnapshot> {
	const sdk = await import("@earendil-works/pi-coding-agent");
	const dir = sdk.getAgentDir();
	const settingsManager = sdk.SettingsManager.create(root, dir, {
		projectTrusted: true,
	});
	const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: dir, settingsManager });
	await loader.reload();

	const skills = loader.getSkills();
	const prompts = loader.getPrompts();
	const extensions = loader.getExtensions();
	const agentsFiles = loader.getAgentsFiles().agentsFiles;
	const extensionList: ExtensionLike[] = extensions.extensions;

	const loadedSkillPaths = new Set(
		skills.skills.map((skill) => path.resolve(skill.filePath).toLowerCase()),
	);
	const unloadedSkills = scanUnloadedSkills(root, dir, loadedSkillPaths)
		.map((entry) => unloadedSkillItem(entry.filePath, entry.scope, sdk))
		.filter((item): item is CustomizationItem => item !== null);
	const loadedInstructionPaths = new Set(
		agentsFiles.map((file) => path.resolve(file.path).toLowerCase()),
	);
	const markCurrent = (item: CustomizationItem): CustomizationItem =>
		item.filePath && isPathInsideRoot(root, item.filePath) ? { ...item, current: true } : item;

	return {
		root,
		agents: [
			...listAgents(root, dir, sdk).map(markCurrent),
			...otherWorkspaceAgents(root, workspaces, sdk),
		],
		skills: [
			...skills.skills
				.map((skill) => ({
					id: skill.filePath,
					name: skill.name,
					description: skill.filePath,
					filePath: skill.filePath,
					scope: scopeOf(skill.sourceInfo),
					source: packageSource(skill.sourceInfo),
					enabled: !skill.disableModelInvocation,
					warning: skillWarningOf(skill.name, skill.description),
				}))
				.map(markCurrent),
			...unloadedSkills.map(markCurrent),
			...otherWorkspaceSkillItems(root, workspaces, dir, loadedSkillPaths, sdk),
		],
		instructions: [
			...agentsFiles.map((file): CustomizationItem => {
				const isUser = isPathInsideRoot(dir, file.path);
				return {
					id: file.path,
					name: isUser ? path.basename(file.path) : workspaceTitle(file.path),
					description: file.path,
					filePath: file.path,
					scope: isUser ? "user" : "project",
					removable: isUser || isWorkspaceRootFile(file.path, workspaces),
					current: isWorkspaceRootFile(file.path, [root]),
				};
			}),
			...workspaceInstructionItems(workspaces, loadedInstructionPaths),
		],
		prompts: listPrompts(root, dir, sdk, prompts.prompts),
		hooks: [],
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
};

/** 新建定制项的用户级目录（对应 pi 的 agentDir 约定），文件内容留空由用户填写。 */
const CREATE_TEMPLATES: Record<Exclude<CustomizationCreateKind, "skills">, CreateTemplate> = {
	agents: {
		base: "new-agent",
		relative: (name) => path.join("agents", `${name}.md`),
	},
	instructions: {
		base: "AGENTS",
		relative: () => "AGENTS.md",
	},
	prompts: {
		base: "new-prompt",
		relative: (name) => path.join("prompts", `${name}.md`),
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

/** 在用户目录创建空文件，返回供编辑器打开的路径。 */
export function createCustomization(kind: CustomizationCreateKind): { filePath: string } {
	if (kind === "skills") {
		throw new Error("Create skills from the editor draft instead");
	}
	const dir = agentDir();
	const template = CREATE_TEMPLATES[kind];
	if (kind === "instructions") {
		const filePath = path.join(dir, template.relative(""));
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, "", "utf8");
		}
		return { filePath };
	}
	const name = availableName(template.base, (candidate) =>
		fs.existsSync(path.join(dir, template.relative(candidate))),
	);
	const filePath = path.join(dir, template.relative(name));
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, "", "utf8");
	return { filePath };
}

/** 允许启停与删除的定制文件目录：用户级与工作区级的 agents/prompts。 */
function editableRoots(root?: string, workspaces: readonly string[] = []): string[] {
	const dir = agentDir();
	const roots = [path.join(dir, "agents"), path.join(dir, "prompts")];
	const bases = [...(root ? [root] : []), ...workspaces];
	for (const base of bases) {
		roots.push(path.join(base, ".pi", "agents"), path.join(base, ".pi", "prompts"));
	}
	return roots;
}

function resolveEditableFile(
	filePath: string,
	root?: string,
	workspaces: readonly string[] = [],
): string {
	const target = path.resolve(filePath);
	if (!isCustomizationFile(path.basename(target))) {
		throw new Error(`Not an agent/prompt file: ${filePath}`);
	}
	if (!editableRoots(root, workspaces).some((base) => isPathInsideRoot(base, target))) {
		throw new Error(`Only user and workspace agents/prompts can be changed: ${filePath}`);
	}
	if (!fs.existsSync(target)) throw new Error(`File not found: ${filePath}`);
	return target;
}

/** 启停定制文件：重命名为 `*.md.disabled`，恢复时去掉后缀。 */
export function setCustomizationItemEnabled(
	filePath: string,
	enabled: boolean,
	root?: string,
	workspaces: readonly string[] = [],
): { filePath: string } {
	const target = resolveEditableFile(filePath, root, workspaces);
	const disabled = target.endsWith(DISABLED_EXT);
	if (enabled && !disabled) return { filePath: target };
	if (!enabled && disabled) return { filePath: target };
	const next = enabled ? target.slice(0, -DISABLED_EXT.length) : `${target}${DISABLED_EXT}`;
	if (fs.existsSync(next)) throw new Error(`File already exists: ${next}`);
	fs.renameSync(target, next);
	return { filePath: next };
}

/** 删除定制文件（已禁用的文件同样可删）。 */
export function removeCustomizationItem(
	filePath: string,
	root?: string,
	workspaces: readonly string[] = [],
): { filePath: string } {
	if (isInstructionFile(filePath)) {
		const target = removableInstructionPath(filePath, root, workspaces);
		if (!target) throw new Error(`Instruction file cannot be removed: ${filePath}`);
		if (!fs.existsSync(target)) throw new Error(`File not found: ${filePath}`);
		fs.rmSync(target, { force: false });
		return { filePath: target };
	}
	const target = resolveEditableFile(filePath, root, workspaces);
	fs.rmSync(target, { force: false });
	return { filePath: target };
}
