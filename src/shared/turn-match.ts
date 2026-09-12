/**
 * 界面气泡与 Agent 会话轮次的对齐检查。
 * 界面文本经过清洗/截断，因此按去掉空白后的前缀比较，只用于确认「是同一轮」。
 */

function squeeze(text: string): string {
	return text.replace(/\s+/g, "");
}

/** 取消息内容里的纯文本（string 或 text 片段）。 */
export function messageContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: unknown; text?: unknown };
		if (p.type === "text" && typeof p.text === "string") text += p.text;
	}
	return text;
}

const PROBE_CHARS = 80;

/** 界面气泡文本是否指向 Agent 侧这一轮的提示词；界面无文本（纯图片轮）时不阻断。 */
export function turnTextMatches(agentText: string, uiText: string | undefined): boolean {
	const ui = squeeze(uiText ?? "");
	if (!ui) return true;
	return squeeze(agentText).includes(ui.slice(0, PROBE_CHARS));
}
