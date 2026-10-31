import {
  EXTENDED_STANDARD_HTML_TAGS,
  hasCompleteHtmlTagContent,
  tokenizeHtml,
  type HtmlToken,
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

type HtmlNode = ParsedNode & {
  tag?: string;
  attrs?: Array<[string, string | null]>;
  content?: string;
  raw?: string;
  children?: ParsedNode[];
};

function startTagText(tag: string, attrs: Record<string, string>): string {
  const text = Object.entries(attrs)
    .map(([key, value]) => (value === "" ? ` ${key}` : ` ${key}="${value}"`))
    .join("");
  return `<${tag}${text}`;
}

function htmlNode(
  tag: string,
  attrs: Record<string, string>,
  children: ParsedNode[] | null,
): HtmlNode {
  const open = `${startTagText(tag, attrs)}${children ? ">" : " />"}`;
  const inner = children
    ? children.map((child) => (child as HtmlNode).raw ?? (child as HtmlNode).content ?? "").join("")
    : "";
  const raw = children ? `${open}${inner}</${tag}>` : open;
  return {
    type: "html_block",
    tag,
    attrs: Object.entries(attrs).map(([key, value]) => [key, value === "" ? null : value]),
    content: raw,
    raw,
    children: children ?? undefined,
  } as HtmlNode;
}

function containsImgTag(content: string): boolean {
  return /<img[\s/>]/i.test(content);
}

/** 只有「容器里就一张图」才处理，徽章那种 <a><img></a> 连同链接一起保留原样。 */
const IMAGE_CONTAINER_TAGS = new Set(["p", "div", "center", "figure", "section"]);

function imageToken(tokens: HtmlToken[]): HtmlToken | null {
  return (
    tokens.find(
      (token) =>
        (token.type === "tag_open" || token.type === "self_closing") &&
        (token.tagName ?? "").toLowerCase() === "img",
    ) ?? null
  );
}

function onlyWrapperTags(tokens: HtmlToken[], tag: string): boolean {
  return tokens.every(
    (token) =>
      token.type === "text" ||
      (token.tagName ?? "").toLowerCase() === "img" ||
      (token.tagName ?? "").toLowerCase() === tag,
  );
}

/**
 * markstream 只给「顶层标签就是自定义组件」的 HTML 块走组件渲染，`<p><img></p>` 这类
 * 容器块会整块退回原始 HTML，本地图片地址因此加载不出来。容器里只有一张图时，
 * 直接把节点换成 img，让它命中 HtmlImageNode；容器的 align 转给图片自己。
 */
function extractImage(node: ParsedNode): ParsedNode {
  if (node.type !== "html_block") return node;
  const record = node as HtmlNode;
  const tag = (record.tag ?? "").trim().toLowerCase();
  const content = String(record.content ?? "");
  if (!IMAGE_CONTAINER_TAGS.has(tag) || !containsImgTag(content)) return node;
  const tokens = tokenizeHtml(content);
  const image = imageToken(tokens);
  if (!image || !onlyWrapperTags(tokens, tag)) return node;
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(image.attrs ?? {})) attrs[key] = value ?? "";
  const align = (record.attrs ?? []).find(([key]) => key.toLowerCase() === "align")?.[1];
  if (align && !attrs.align) attrs.align = align;
  return htmlNode("img", attrs, null);
}

function extractImages(nodes: ParsedNode[]): ParsedNode[] {
  return nodes.map((node) => {
    const next = extractImage(node);
    const children = (next as { children?: ParsedNode[] }).children;
    if (!Array.isArray(children)) return next;
    return { ...next, children: extractImages(children) } as ParsedNode;
  });
}

/** markstream 的解析钩子：HTML 策略放宽到 trusted，同时补上旧管线的两条行为。 */
export const MARKDOWN_PARSE_OPTIONS: ParseOptions = {
  postTransformNodes: transformNodes,
};

/** 文件预览用的解析钩子：额外让容器里的 HTML 图片走自定义组件。 */
export const MARKDOWN_HTML_PARSE_OPTIONS: ParseOptions = {
  postTransformNodes: (nodes) => extractImages(transformNodes(nodes)),
};
