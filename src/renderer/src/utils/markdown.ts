import DOMPurify from "dompurify";
import katex from "katex";
import { marked, type Token } from "marked";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/common";
import {
  resolveMarkdownImageSrc,
  type MarkdownAssetBase,
} from "@renderer/utils/markdown-assets";

let copyButtonLabel = "Copy";

/**
 * 解析上下文：marked 渲染器是全局单例，只能靠调用前后切换。
 * 图片的相对路径按它所属文档的目录解析。
 */
let currentAssets: MarkdownAssetBase | null = null;

/** 允许应用内协议：默认规则不认 pi-local/pi-media，会把 src 整条抹掉。 */
export const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|pi-local|pi-media):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** Update copy button label (i18n). Safe to call from Vue setup. */
export function setMarkdownCopyLabel(label: string): void {
  const next = label || "Copy";
  if (next === copyButtonLabel) return;
  copyButtonLabel = next;
  // Cached HTML bakes the copy-button label in — drop it on locale switch.
  htmlCache.clear();
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
  }),
);

function diagramPlaceholder(kind: "mermaid" | "dot", source: string): string {
  const attrs =
    kind === "mermaid"
      ? `class="md-diagram md-mermaid" data-mermaid data-diagram="mermaid"`
      : `class="md-diagram" data-diagram="dot"`;
  return [
    `<div ${attrs}>`,
    `<pre class="md-diagram-src">${escapeHtml(source)}</pre>`,
    `</div>`,
  ].join("");
}

/** Fence langs that should render via Mermaid (not highlight.js). */
const MERMAID_LANGS = new Set([
  "mermaid",
  "flowchart",
  "sequence",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "statediagram-v2",
  "erdiagram",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitgraph",
  "journey",
  "quadrantchart",
  "xychart-beta",
  "sankey-beta",
  "requirementdiagram",
  "architecture-beta",
]);

/** Detect untitled fences that are clearly Mermaid diagrams. */
function looksLikeMermaidSource(source: string): boolean {
  const head = source.trimStart();
  return /^(flowchart|graph\s+(TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|gitGraph|journey)\b/m.test(
    head,
  );
}

function renderMathBlock(source: string): string {
  try {
    return `<div class="md-math-block">${katex.renderToString(source, {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
    })}</div>`;
  } catch {
    return `<pre class="md-math-fallback">${escapeHtml(source)}</pre>`;
  }
}

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || "").trim().split(/\s+/)[0] || "";
      const langKey = language.toLowerCase();
      const source = text.replace(/\n$/, "");

      if (MERMAID_LANGS.has(langKey) || (!langKey && looksLikeMermaidSource(source))) {
        return diagramPlaceholder("mermaid", source);
      }
      if (langKey === "dot" || langKey === "graphviz" || langKey === "gv") {
        return diagramPlaceholder("dot", source);
      }
      if (langKey === "math" || langKey === "latex" || langKey === "katex" || langKey === "tex") {
        return renderMathBlock(source);
      }

      const highlighted = highlightCode(text, language);
      const lines = text.replace(/\n$/, "").split("\n");
      const nos = lines.map((_, i) => `<span>${i + 1}</span>`).join("");
      const label = language || "code";
      return [
        `<div class="code-block" data-code-block>`,
        `<div class="code-head"><span class="lang">${escapeHtml(label)}</span>`,
        `<button type="button" class="copy-btn" data-copy>${escapeHtml(copyButtonLabel)}</button></div>`,
        `<div class="code-body"><div class="line-nos" aria-hidden="true">${nos}</div>`,
        `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`,
        `</div></div>`,
      ].join("");
    },
    link({
      href,
      title,
      text,
      tokens,
    }: {
      href: string;
      title?: string | null;
      text: string;
      tokens?: Token[];
    }) {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      // token.text 是链接标签的原文，未转义；含 < > & 时会破坏 HTML 结构。
      const label = tokens?.length ? this.parser.parseInline(tokens) : escapeHtml(text);
      return `<a href="${escapeHtml(href)}"${titleAttr} rel="noopener noreferrer">${label}</a>`;
    },
    image({
      href,
      title,
      text,
    }: {
      href: string;
      title?: string | null;
      text: string;
    }) {
      // 相对路径图片按文档所在目录解析；解析不了就交回默认渲染器。
      const src = resolveMarkdownImageSrc(href, currentAssets);
      if (!src) return false;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${titleAttr}>`;
    },
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * highlightAuto probes every registered language and is the slowest hljs path —
 * past a size cap it costs more than it's worth, so fall back to plain escaped
 * text (still perfectly readable).
 */
const HIGHLIGHT_AUTO_MAX_CHARS = 8_000;
/** 显式语言高亮同样有上限：十万级字符的同步高亮会长时间占住渲染线程。 */
const HIGHLIGHT_LANG_MAX_CHARS = 24_000;

function highlightAutoCapped(text: string): string {
  if (text.length > HIGHLIGHT_AUTO_MAX_CHARS) return escapeHtml(text);
  return hljs.highlightAuto(text).value;
}

/**
 * 全量重解析会反复高亮同一段代码（流式尾部增长、虚拟窗口重挂载），
 * 按“语言 + 源码”缓存结果；超大代码块不缓存，避免常驻内存。
 */
const highlightCache = new Map<string, string>();
const HIGHLIGHT_CACHE_MAX_ENTRIES = 48;
const HIGHLIGHT_CACHE_MAX_CHARS = 24_000;

export function highlightCode(text: string, language: string): string {
  if (text.length > HIGHLIGHT_LANG_MAX_CHARS) return escapeHtml(text);
  const key =
    text.length <= HIGHLIGHT_CACHE_MAX_CHARS ? `${language}\u0000${text}` : "";
  const hit = key ? highlightCache.get(key) : undefined;
  if (hit !== undefined) {
    highlightCache.delete(key);
    highlightCache.set(key, hit);
    return hit;
  }
  let highlighted: string;
  try {
    highlighted =
      language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language }).value
        : highlightAutoCapped(text);
  } catch {
    highlighted = escapeHtml(text);
  }
  if (key) {
    highlightCache.set(key, highlighted);
    if (highlightCache.size > HIGHLIGHT_CACHE_MAX_ENTRIES) {
      const oldest = highlightCache.keys().next().value;
      if (oldest !== undefined) highlightCache.delete(oldest);
    }
  }
  return highlighted;
}

/**
 * 代码高亮 → 可直接注入的 HTML。
 *
 * hljs 的输出只含固定 class 的 span、源文本已被转义；这里再过一遍净化器，
 * 让文件视图不必依赖外层 markdown 的净化流程。
 */
export function highlightToSafeHtml(text: string, language: string): string {
  return DOMPurify.sanitize(highlightCode(text, language), {
    ALLOWED_TAGS: ["span", "br"],
    ALLOWED_ATTR: ["class"],
  });
}

function wrapTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    return `<div class="md-table-scroll">${table}</div>`;
  });
}

/**
 * Parse GFM markdown → sanitized HTML for chat bubbles.
 *
 * Virtual-window remounts re-render the same finished answers on every scroll;
 * an LRU of rendered HTML keeps those remounts near-free.
 */
const htmlCache = new Map<string, string>();
const HTML_CACHE_MAX_ENTRIES = 300;
const HTML_CACHE_SKIP_CHARS = 120_000;

/** 缓存键要带上图片解析基准：同一段内容在不同目录下的图片地址不同。 */
function cacheKey(content: string, assets: MarkdownAssetBase | null): string {
  if (!assets) return content;
  return `${assets.dir}\u0000${assets.root ?? ""}\u0000${content}`;
}

export function renderMarkdownCached(
  content: string,
  assets: MarkdownAssetBase | null = null,
): string {
  const key = cacheKey(content, assets);
  if (key.length > MESSAGE_MARKDOWN_MAX_CHARS) return renderPlainTextBlock(content);
  if (key.length > HTML_CACHE_SKIP_CHARS) return renderMarkdown(content, assets);
  const hit = htmlCache.get(key);
  if (hit !== undefined) {
    htmlCache.delete(key);
    htmlCache.set(key, hit);
    return hit;
  }
  const html = renderMarkdown(content, assets);
  htmlCache.set(key, html);
  if (htmlCache.size > HTML_CACHE_MAX_ENTRIES) {
    const oldest = htmlCache.keys().next().value;
    if (oldest !== undefined) htmlCache.delete(oldest);
  }
  return html;
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
/** 续接上一个块的行：缩进代码、松散列表项 —— 其前的空行不是块边界。 */
const BLOCK_CONTINUE_RE = /^(?: {4,}|\t|\s*[-*+]\s|\s*\d{1,9}[.)]\s)/;

function fenceOpenMarker(line: string): string {
  return FENCE_OPEN_RE.exec(line)?.[1] ?? "";
}

function closesFence(line: string, fence: string): boolean {
  const marker = FENCE_CLOSE_RE.exec(line)?.[1];
  return Boolean(marker && marker[0] === fence[0] && marker.length >= fence.length);
}

export type StreamBlockSplitter = {
  /** 已确认可独立解析的内容长度（以空行收尾，且不在围栏内）。 */
  readonly boundary: number;
  /** 最后一个已闭合围栏的结束位置；还没有闭合围栏时为 0。 */
  readonly closedFenceEnd: number;
  /** 当前是否停在未闭合的围栏里。 */
  readonly inFence: boolean;
  /** 返回自上次调用以来新定型的文本段；无进展时返回空串。 */
  take(content: string): string;
};

/**
 * 流式块切分器：只增量扫描新增行，维护围栏与块延续状态，给出可独立解析的
 * 块边界。逐块解析后拼接，替换掉“每个 chunk 全量重解析整篇回答”的做法。
 */
export function createStreamBlockSplitter(): StreamBlockSplitter {
  let scanned = 0;
  let boundary = 0;
  let rendered = 0;
  let pending = -1;
  let fence = "";
  let closedFenceEnd = 0;
  let partialLine = "";

  function reset(): void {
    scanned = 0;
    boundary = 0;
    rendered = 0;
    pending = -1;
    fence = "";
    closedFenceEnd = 0;
    partialLine = "";
  }

  /** 尾部未换行的那一行也可能已经开启/闭合了围栏，必须一并计入。 */
  function partialClosesFence(): boolean {
    return fence !== "" && closesFence(partialLine, fence);
  }

  function consumeLine(line: string, lineEnd: number): void {
    if (fence) {
      if (closesFence(line, fence)) {
        fence = "";
        closedFenceEnd = lineEnd;
      }
      return;
    }
    if (line.trim() === "") {
      pending = lineEnd;
      return;
    }
    const marker = fenceOpenMarker(line);
    if (marker) {
      if (pending >= 0) {
        boundary = pending;
        pending = -1;
      }
      fence = marker;
      return;
    }
    if (pending < 0) return;
    if (BLOCK_CONTINUE_RE.test(line)) {
      pending = -1;
      return;
    }
    boundary = pending;
    pending = -1;
  }

  return {
    get boundary(): number {
      return boundary;
    },
    get closedFenceEnd(): number {
      return partialClosesFence() ? scanned + partialLine.length : closedFenceEnd;
    },
    get inFence(): boolean {
      if (fence) return !partialClosesFence();
      return fenceOpenMarker(partialLine) !== "";
    },
    take(content: string): string {
      if (content.length < scanned) reset();
      let pos = scanned;
      while (pos < content.length) {
        const nl = content.indexOf("\n", pos);
        if (nl < 0) break;
        consumeLine(content.slice(pos, nl), nl + 1);
        pos = nl + 1;
      }
      scanned = pos;
      partialLine = content.slice(pos);
      if (boundary <= rendered) return "";
      const added = content.slice(rendered, boundary);
      rendered = boundary;
      return added;
    },
  };
}

/** 单块解析上限：超过后按纯文本渲染，避免一次同步解析 + 净化长时间冻结渲染线程。 */
const BLOCK_MARKDOWN_MAX_CHARS = 32_000;
/** 已完成消息全量解析上限：极端长回答直接纯文本，保证界面可用。 */
const MESSAGE_MARKDOWN_MAX_CHARS = 120_000;

/**
 * markdown 容器的 class 列表。变体类与 CSS Module 类之间必须留空格：
 * 粘连成 `md-chatroot_hash` 时，`.md.md-chat` 这类选择器全部失配，
 * 聊天样式（代码块悬浮复制按钮、隐藏语言标签、隐藏行号）整块失效。
 */
export function markdownRootClassName(
  variant: "default" | "chat" | undefined,
  moduleClass: string,
  extra?: string,
): string {
  const variantClass = variant === "chat" ? "md md-chat" : "md";
  return `${variantClass} ${moduleClass}${extra ? ` ${extra}` : ""}`;
}

function renderPlainTextBlock(content: string): string {
  return `<pre class="md-plain-block">${escapeHtml(content)}</pre>`;
}

/** 块级 markdown 渲染：超大块降级为纯文本。 */
export function renderMarkdownBlock(
  content: string,
  assets: MarkdownAssetBase | null = null,
): string {
  const text = content ?? "";
  return text.length > BLOCK_MARKDOWN_MAX_CHARS
    ? renderPlainTextBlock(text)
    : renderMarkdown(text, assets);
}

/** 解析 markdown：图片相对路径依赖文档目录，解析期间临时挂上基准。 */
function parseWithAssets(
  content: string,
  assets: MarkdownAssetBase | null,
): string {
  const previous = currentAssets;
  currentAssets = assets;
  try {
    return marked.parse(content || "", { async: false }) as string;
  } finally {
    currentAssets = previous;
  }
}

/** Parse GFM markdown → sanitized HTML for chat bubbles (uncached). */
export function renderMarkdown(
  content: string,
  assets: MarkdownAssetBase | null = null,
): string {
  const raw = parseWithAssets(content, assets);
  return DOMPurify.sanitize(wrapTables(raw), {
    ALLOWED_URI_REGEXP,
    ADD_TAGS: ["button", "input"],
    ADD_ATTR: [
      "data-copy",
      "data-code-block",
      "data-mermaid",
      "data-diagram",
      "data-diagram-action",
      "data-diagram-zoom-label",
      "aria-label",
      "aria-hidden",
      "target",
      "rel",
      "type",
      "checked",
      "disabled",
      "class",
      "style",
      "hidden",
      "xmlns",
      "viewBox",
      "fill",
      "stroke",
      "d",
      "cx",
      "cy",
      "r",
      "x",
      "y",
      "width",
      "height",
      "transform",
      "text-anchor",
      "font-family",
      "font-size",
    ],
  });
}

/** Pure marked output for unit tests (no DOMPurify / window). */
export function parseMarkdownRaw(
  content: string,
  assets: MarkdownAssetBase | null = null,
): string {
  return parseWithAssets(content, assets);
}
