import {
  EXTENDED_STANDARD_HTML_TAGS,
  hasCompleteHtmlTagContent,
  type ParsedNode,
  type ParseOptions,
} from "stream-markdown-parser";

/**
 * trusted 策略只拦 <script>；这些标签会污染全局样式或加载外部内容，同样剔除。
 * 正则未闭合时匹配到文本结尾，流式中途的半截标签也一并清掉。
 */
const UNSAFE_HTML_TAG_RE =
  /<(style|iframe|object|embed|form|base|link|meta|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;

const LEADING_TAG_RE = /^\s*<\s*([A-Za-z][\w-]*)(?=[\s/>]|$)/;

function isUnknownTag(tag: string): boolean {
  return !EXTENDED_STANDARD_HTML_TAGS.has(tag.toLowerCase());
}

function stripUnsafeHtml(content: string): string {
  return content.replace(UNSAFE_HTML_TAG_RE, "");
}

function asHtmlBlock(tag: string, content: string): ParsedNode {
  return { type: "html_block", tag, content, raw: content } as ParsedNode;
}

/**
 * 渲染器把「未闭合的未知标签」降级成普通段落，会把 `<thinking>` 原文顶到界面上。
 * 旧渲染管线里这种标签由 HTML 路径处理（浏览器丢弃未知元素、内容照常显示），
 * 这里把段落还原成 html_block，交给同一条 HTML 路径。
 */
function restoreUnknownTagParagraph(node: ParsedNode): ParsedNode {
  if (node.type !== "paragraph") return node;
  const raw = String((node as { raw?: string }).raw ?? "").trim();
  const tag = LEADING_TAG_RE.exec(raw)?.[1];
  if (!tag || !isUnknownTag(tag)) return node;
  if (hasCompleteHtmlTagContent(raw, tag)) return node;
  return asHtmlBlock(tag, raw);
}

function cleanHtmlNode(node: ParsedNode): ParsedNode {
  const record = node as { content?: string; raw?: string };
  const content = String(record.content ?? "");
  const raw = String(record.raw ?? "");
  const nextContent = stripUnsafeHtml(content);
  const nextRaw = stripUnsafeHtml(raw);
  if (nextContent === content && nextRaw === raw) return node;
  return { ...node, content: nextContent, raw: nextRaw } as ParsedNode;
}

function transformNodes(nodes: ParsedNode[]): ParsedNode[] {
  return nodes.map((node) => {
    const next = restoreUnknownTagParagraph(node);
    if (next.type === "html_block" || next.type === "html_inline") {
      return cleanHtmlNode(next);
    }
    const children = (next as { children?: ParsedNode[] }).children;
    if (!Array.isArray(children) || children.length === 0) return next;
    return { ...next, children: transformNodes(children) } as ParsedNode;
  });
}

/** markstream 的解析钩子：HTML 策略放宽到 trusted，同时补上旧管线的两条行为。 */
export const MARKDOWN_PARSE_OPTIONS: ParseOptions = {
  postTransformNodes: transformNodes,
};
