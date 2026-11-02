import { stripAttachedImagesBlock } from "./chat-meta";
import { stripInjectedBlocks } from "./injected-blocks";

/** 派生会话的标题前缀与长度上限。 */
const FORK_TITLE_PREFIX = "Forked: ";
const FORK_TITLE_MAX = 60;

/** 派生会话标题：取分叉点消息文本，为空时回退为 `Forked: ` + 源会话名。 */
export function forkTitleFor(
	turnText: string,
	sourceName: string | null,
): string | null {
	const clean = stripInjectedBlocks(stripAttachedImagesBlock(turnText))
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, FORK_TITLE_MAX);
	if (clean) return clean;
	if (!sourceName) return null;
	const src = sourceName.replace(/\s+/g, " ").trim().slice(0, FORK_TITLE_MAX);
	return src ? `${FORK_TITLE_PREFIX}${src}` : null;
}
