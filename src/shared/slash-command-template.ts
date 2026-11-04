/** 文件型斜杠命令（Claude / OpenCode 的 markdown 模板）的参数与渲染规则。 */

export type ExpandableCommand = {
	name: string;
	content: string;
};

const BRACED_ARG = /\$\{(\d+|@)(?::([^}]*))?\}/g;
const BARE_ARG = /\$@\[(\d+)(?::(\d*))?\]|\$ARGUMENTS|\$@|\$(\d+)/g;
const INLINE_ARG = /\$(?:ARGUMENTS|@(?:\[\d+(?::\d*)?\])?|\d+)|\$\{(?:\d+|@)[^}]*\}/;

/** 与 pi/omp 一致的参数切分：支持单双引号，空白分隔。 */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;
	for (const char of argsString) {
		if (inQuote) {
			if (char === inQuote) inQuote = null;
			else current += char;
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}
	if (current) args.push(current);
	return args;
}

function argsSlice(args: string[], startRaw: string, lengthRaw?: string): string {
	const start = Number(startRaw);
	if (!Number.isInteger(start) || start < 1) return "";
	const startIndex = start - 1;
	if (startIndex >= args.length) return "";
	if (lengthRaw === undefined || lengthRaw === "") {
		return args.slice(startIndex).join(" ");
	}
	const length = Number(lengthRaw);
	if (!Number.isInteger(length) || length <= 0) return "";
	return args.slice(startIndex, startIndex + length).join(" ");
}

/** 渲染命令模板：支持 $1、$@、$ARGUMENTS、$@[N]、$@[N:L] 与 ${1:-默认值} 等写法。 */
export function renderCommandTemplate(content: string, argsString: string): string {
	const args = parseCommandArgs(argsString);
	const argsText = args.join(" ");
	const hasInlineArgs = INLINE_ARG.test(content);

	const braced = content.replace(
		BRACED_ARG,
		(_match, token: string, spec?: string) => {
			const value =
				token === "@" ? argsText : (args[Number(token) - 1] ?? "");
			if (spec === undefined) return value;
			if (spec.startsWith("-")) return value || spec.slice(1);
			return argsSlice(args, ...(spec.split(":") as [string, string?]));
		},
	);

	const rendered = braced.replace(
		BARE_ARG,
		(match, startRaw?: string, lengthRaw?: string, positional?: string) => {
			if (positional !== undefined) {
				return args[Number(positional) - 1] ?? "";
			}
			if (startRaw !== undefined) {
				return argsSlice(args, startRaw, lengthRaw);
			}
			return match === "$ARGUMENTS" || match === "$@" ? argsText : match;
		},
	);

	if (!argsText || hasInlineArgs) return rendered;
	return rendered ? `${rendered}\n\n${argsText}` : argsText;
}

/** 解析首行的 `/name args`；命令名包含命名空间的冒号。 */
export function parseSlashInvocation(text: string): {
	name: string;
	args: string;
} | null {
	const newline = text.indexOf("\n");
	const firstLine = newline === -1 ? text : text.slice(0, newline);
	const match = /^\/(\S+)(?:[ \t]+([\s\S]*))?$/.exec(firstLine);
	if (!match) return null;
	return { name: match[1] ?? "", args: match[2] ?? "" };
}

/** 命中文件型命令时展开模板，未命中返回原文。 */
export function expandCommandText(
	text: string,
	commands: readonly ExpandableCommand[],
): string {
	const lines = text.split("\n");
	const indices = lines.length > 1 ? [0, lines.length - 1] : [0];
	for (const index of indices) {
		const line = lines[index] ?? "";
		const invocation = parseSlashInvocation(line);
		if (!invocation || invocation.name.startsWith("skill:")) continue;
		const command = commands.find((item) => item.name === invocation.name);
		if (!command) continue;
		const rendered = renderCommandTemplate(command.content, invocation.args);
		if (index === 0) {
			const rest = lines.slice(1).join("\n");
			return rest.trim() ? `${rendered}\n\n${rest}` : rendered;
		}
		const head = lines.slice(0, index).join("\n");
		return head.trim() ? `${head}\n\n${rendered}` : rendered;
	}
	return text;
}
