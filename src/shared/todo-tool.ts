/**
 * 与 OMP 内置 `todo` 工具一致的清单契约。
 *
 * pi 与 omp 两个后端使用同一套 phase/task 状态与 op 语义；渲染层只消费
 * `details.phases` 快照，因此两边面板行为一致。
 */

export const TODO_TOOL_NAME = "todo";

export const TODO_OPERATIONS = [
	"init",
	"start",
	"done",
	"rm",
	"drop",
	"block",
	"unblock",
	"append",
	"view",
] as const;

export type TodoOperation = (typeof TODO_OPERATIONS)[number];

export type TodoItemStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "abandoned"
	| "blocked";

export type TodoItem = {
	content: string;
	status: TodoItemStatus;
	blocker?: string;
};

export type TodoPhase = {
	name: string;
	tasks: TodoItem[];
};

export type TodoInitEntry = {
	phase: string;
	items: string[];
};

export type TodoToolParams = {
	op?: TodoOperation;
	list?: TodoInitEntry[];
	task?: string;
	phase?: string;
	items?: string[];
	reason?: string;
};

export type TodoToolDetails = {
	op: TodoOperation;
	phases: TodoPhase[];
	storage: "session" | "memory";
};

const DEFAULT_INIT_PHASE = "Tasks";

const TODO_ITEM_STATUSES: Readonly<Record<string, true>> = {
	pending: true,
	in_progress: true,
	completed: true,
	abandoned: true,
	blocked: true,
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** 校验持久化载荷里的 phases 结构（会话历史恢复用）。 */
export function isTodoPhaseList(value: unknown): value is TodoPhase[] {
	if (!Array.isArray(value)) return false;
	for (const rawPhase of value) {
		const phase = asRecord(rawPhase);
		if (!phase || typeof phase.name !== "string") return false;
		if (!Array.isArray(phase.tasks)) return false;
		for (const rawTask of phase.tasks) {
			const task = asRecord(rawTask);
			if (!task || typeof task.content !== "string") return false;
			if (
				typeof task.status !== "string" ||
				!Object.hasOwn(TODO_ITEM_STATUSES, task.status)
			) {
				return false;
			}
			if (task.blocker !== undefined && typeof task.blocker !== "string") {
				return false;
			}
		}
	}
	return true;
}

function cloneItem(item: TodoItem): TodoItem {
	return item.blocker === undefined
		? { content: item.content, status: item.status }
		: { content: item.content, status: item.status, blocker: item.blocker };
}

function cloneTodoPhases(phases: readonly TodoPhase[]): TodoPhase[] {
	return phases.map((phase) => ({
		name: phase.name,
		tasks: phase.tasks.map(cloneItem),
	}));
}

function isTodoOperation(value: unknown): value is TodoOperation {
	return (
		typeof value === "string" &&
		(TODO_OPERATIONS as readonly string[]).includes(value)
	);
}

function normalizeInProgressTask(phases: TodoPhase[]): void {
	const ordered = phases.flatMap((phase) => phase.tasks);
	if (!ordered.length) return;
	const active = ordered.filter((task) => task.status === "in_progress");
	if (active.length > 1) {
		for (const task of active.slice(1)) task.status = "pending";
	}
	if (active.length > 0) return;
	const firstPending = ordered.find((task) => task.status === "pending");
	if (firstPending) firstPending.status = "in_progress";
}

function findTask(
	phases: TodoPhase[],
	content: string,
): { task: TodoItem; phase: TodoPhase } | undefined {
	for (const phase of phases) {
		const task = phase.tasks.find((candidate) => candidate.content === content);
		if (task) return { task, phase };
	}
	return undefined;
}

function findPhase(phases: TodoPhase[], name: string): TodoPhase | undefined {
	return phases.find((phase) => phase.name === name);
}

function resolveTask(
	phases: TodoPhase[],
	content: string | undefined,
	errors: string[],
): { task: TodoItem; phase: TodoPhase } | undefined {
	if (!content) {
		errors.push("Missing task content");
		return undefined;
	}
	const hit = findTask(phases, content);
	if (!hit) {
		const total = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
		errors.push(
			`Task "${content}" not found${total === 0 ? " (todo list is empty)" : ""}`,
		);
	}
	return hit;
}

function resolvePhase(
	phases: TodoPhase[],
	name: string | undefined,
	errors: string[],
): TodoPhase | undefined {
	if (!name) {
		errors.push("Missing phase name");
		return undefined;
	}
	const phase = findPhase(phases, name);
	if (!phase) errors.push(`Phase "${name}" not found`);
	return phase;
}

function targetTasks(
	phases: TodoPhase[],
	params: TodoToolParams,
	errors: string[],
): TodoItem[] {
	if (params.task) {
		const hit = resolveTask(phases, params.task, errors);
		return hit ? [hit.task] : [];
	}
	if (params.phase) {
		const phase = resolvePhase(phases, params.phase, errors);
		return phase ? [...phase.tasks] : [];
	}
	return phases.flatMap((phase) => phase.tasks);
}

function initPhases(
	params: TodoToolParams,
	errors: string[],
): TodoPhase[] {
	const flat =
		params.items && params.items.length > 0
			? [{ phase: params.phase ?? DEFAULT_INIT_PHASE, items: params.items }]
			: undefined;
	const list = params.list?.length ? params.list : (flat ?? params.list);
	if (!list) {
		errors.push("Missing list for init operation");
		return [];
	}
	const seenPhases = new Set<string>();
	const seenTasks = new Set<string>();
	for (const entry of list) {
		if (seenPhases.has(entry.phase)) {
			errors.push(`Duplicate phase "${entry.phase}" in init list`);
		}
		seenPhases.add(entry.phase);
		for (const content of entry.items) {
			if (seenTasks.has(content)) {
				errors.push(`Duplicate task "${content}" in init list`);
			}
			seenTasks.add(content);
		}
	}
	return list.map((entry) => ({
		name: entry.phase,
		tasks: entry.items.map<TodoItem>((content) => ({
			content,
			status: "pending",
		})),
	}));
}

function appendItems(
	phases: TodoPhase[],
	params: TodoToolParams,
	errors: string[],
): TodoPhase[] {
	if (!params.phase) {
		errors.push("Missing phase name for append operation");
		return phases;
	}
	if (!params.items || params.items.length === 0) {
		errors.push("Missing items for append operation");
		return phases;
	}
	const seen = new Set<string>();
	let duplicate = false;
	for (const content of params.items) {
		if (seen.has(content) || findTask(phases, content)) {
			errors.push(`Task "${content}" already exists`);
			duplicate = true;
		}
		seen.add(content);
	}
	if (duplicate) return phases;
	const phase = findPhase(phases, params.phase) ?? {
		name: params.phase,
		tasks: [],
	};
	if (!findPhase(phases, params.phase)) phases.push(phase);
	for (const content of params.items) {
		phase.tasks.push({ content, status: "pending" });
	}
	return phases;
}

function removeTasks(
	phases: TodoPhase[],
	params: TodoToolParams,
	errors: string[],
): TodoPhase[] {
	if (params.task) {
		const hit = resolveTask(phases, params.task, errors);
		if (!hit) return phases;
		hit.phase.tasks = hit.phase.tasks.filter((task) => task !== hit.task);
		return phases;
	}
	if (params.phase) {
		const phase = resolvePhase(phases, params.phase, errors);
		if (!phase) return phases;
		phase.tasks = [];
		return phases;
	}
	for (const phase of phases) phase.tasks = [];
	return phases;
}

function applyEntry(
	phases: TodoPhase[],
	params: TodoToolParams,
	errors: string[],
): TodoPhase[] {
	switch (params.op) {
		case "init":
			return initPhases(params, errors);
		case "start": {
			const hit = resolveTask(phases, params.task, errors);
			if (!hit) return phases;
			for (const phase of phases) {
				for (const task of phase.tasks) {
					if (task.status === "in_progress" && task !== hit.task) {
						task.status = "pending";
					}
				}
			}
			hit.task.status = "in_progress";
			hit.task.blocker = undefined;
			return phases;
		}
		case "done": {
			for (const task of targetTasks(phases, params, errors)) {
				task.status = "completed";
			}
			return phases;
		}
		case "drop": {
			for (const task of targetTasks(phases, params, errors)) {
				task.status = "abandoned";
			}
			return phases;
		}
		case "block": {
			if (!params.task && !params.phase) {
				errors.push("block requires a task or phase target");
				return phases;
			}
			const reason = params.reason?.replace(/\s+/g, " ").trim() || undefined;
			for (const task of targetTasks(phases, params, errors)) {
				if (
					task.status !== "pending" &&
					task.status !== "in_progress" &&
					task.status !== "blocked"
				) {
					continue;
				}
				task.status = "blocked";
				task.blocker = reason;
			}
			return phases;
		}
		case "unblock": {
			if (!params.task && !params.phase) {
				errors.push("unblock requires a task or phase target");
				return phases;
			}
			for (const task of targetTasks(phases, params, errors)) {
				if (task.status === "blocked") {
					task.status = "pending";
					task.blocker = undefined;
				}
			}
			return phases;
		}
		case "rm":
			return removeTasks(phases, params, errors);
		case "append":
			return appendItems(phases, params, errors);
		case "view":
			return phases;
	}
	return phases;
}

function inferOperation(
	raw: Record<string, unknown>,
	hasExisting: boolean,
): TodoOperation | undefined {
	if (Array.isArray(raw.list) && raw.list.length > 0) return "init";
	if (Array.isArray(raw.items) && raw.items.length > 0) {
		if (typeof raw.phase === "string" && raw.phase) return "append";
		if (!hasExisting) return "init";
	}
	return undefined;
}

function parseInitList(value: unknown): TodoInitEntry[] | undefined | null {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return null;
	const entries: TodoInitEntry[] = [];
	for (const raw of value) {
		const entry = asRecord(raw);
		if (!entry || typeof entry.phase !== "string") return null;
		if (!Array.isArray(entry.items)) return null;
		if (!entry.items.every((item) => typeof item === "string")) return null;
		entries.push({ phase: entry.phase, items: entry.items });
	}
	return entries;
}

function optionalString(value: unknown): string | undefined | null {
	if (value === undefined) return undefined;
	return typeof value === "string" ? value : null;
}

/** 校验并修复模型参数（缺 op 时按载荷形状推断）。 */
export function resolveTodoParams(
	raw: unknown,
	hasExisting: boolean,
): TodoToolParams | null {
	const record = asRecord(raw);
	if (!record) return null;
	const op =
		record.op === undefined
			? inferOperation(record, hasExisting)
			: isTodoOperation(record.op)
				? record.op
				: undefined;
	if (!op) return null;
	const list = parseInitList(record.list);
	if (list === null) return null;
	const task = optionalString(record.task);
	const phase = optionalString(record.phase);
	const reason = optionalString(record.reason);
	if (task === null || phase === null || reason === null) return null;
	let items: string[] | undefined;
	if (record.items !== undefined) {
		if (
			!Array.isArray(record.items) ||
			!record.items.every((item) => typeof item === "string")
		) {
			return null;
		}
		items = record.items;
	}
	return {
		op,
		...(list !== undefined ? { list } : {}),
		...(task !== undefined ? { task } : {}),
		...(phase !== undefined ? { phase } : {}),
		...(items !== undefined ? { items } : {}),
		...(reason !== undefined ? { reason } : {}),
	};
}

export function applyTodoParams(
	phases: readonly TodoPhase[],
	params: TodoToolParams,
): { op: TodoOperation; phases: TodoPhase[]; errors: string[] } {
	const op = params.op ?? "view";
	const errors: string[] = [];
	const next = applyEntry(cloneTodoPhases(phases), params, errors);
	if (errors.length || op === "view") {
		return { op, phases: cloneTodoPhases(phases), errors };
	}
	normalizeInProgressTask(next);
	return { op, phases: next, errors };
}

export function formatTodoResult(
	phases: readonly TodoPhase[],
	errors: readonly string[],
): string {
	const lines: string[] = [];
	if (errors.length) lines.push(`Errors: ${errors.join("; ")}`);
	const tasks = phases.flatMap((phase) => phase.tasks);
	if (!tasks.length) {
		lines.push("Todo list is empty.");
		return lines.join("\n");
	}
	const open = phases.flatMap((phase) =>
		phase.tasks
			.filter((task) => task.status === "pending" || task.status === "in_progress")
			.map((task) => ({ phase, task })),
	);
	if (open.length) {
		lines.push(`Remaining items (${open.length}):`);
		for (const { phase, task } of open) {
			lines.push(`  - ${task.content} [${task.status}] (${phase.name})`);
		}
	} else {
		lines.push("Remaining items: none.");
	}
	const closed = tasks.filter(
		(task) => task.status === "completed" || task.status === "abandoned",
	).length;
	const blocked = tasks.filter((task) => task.status === "blocked").length;
	const blockedNote = blocked ? `, ${blocked} blocked` : "";
	lines.push(
		`Overall: ${closed}/${tasks.length} done, ${open.length} open${blockedNote}.`,
	);
	const currentIndex = phases.findIndex((phase) =>
		phase.tasks.some(
			(task) => task.status === "pending" || task.status === "in_progress",
		),
	);
	const current = phases[currentIndex === -1 ? phases.length - 1 : currentIndex];
	if (current) {
		const done = current.tasks.filter(
			(task) => task.status === "completed" || task.status === "abandoned",
		).length;
		const phaseNumber = currentIndex === -1 ? phases.length : currentIndex + 1;
		lines.push(
			`Active phase ${phaseNumber}/${phases.length} "${current.name}" (${done}/${current.tasks.length}).`,
		);
	}
	for (const phase of phases) {
		lines.push(`  ${phase.name}:`);
		for (const task of phase.tasks) {
			const checkbox = task.status === "completed" ? "[X]" : "[ ]";
			const tag =
				task.status === "in_progress"
					? " (in progress)"
					: task.status === "abandoned"
						? " (dropped)"
						: task.status === "blocked"
							? task.blocker
								? ` (blocked: ${task.blocker})`
								: " (blocked)"
							: "";
			lines.push(`    - ${checkbox} ${task.content}${tag}`);
		}
	}
	return lines.join("\n");
}

/**
 * 一行进度摘要，供 reminder 注入下一次请求。
 * 没有可推进项（全部完成/放弃/阻塞）时返回 null。
 */
export function todoProgressLine(
	phases: readonly TodoPhase[],
): string | null {
	const tasks = phases.flatMap((phase) => phase.tasks);
	const done = tasks.filter((task) => task.status === "completed").length;
	const active = tasks.find((task) => task.status === "in_progress");
	const pending = tasks.find((task) => task.status === "pending");
	const next = active ?? pending;
	if (!next) return null;
	return `${done}/${tasks.length} completed · ${active ? "in progress" : "next"}: ${next.content}`;
}
