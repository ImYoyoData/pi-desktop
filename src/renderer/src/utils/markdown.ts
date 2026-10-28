import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";

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
const safeHtmlCache = new Map<string, string>();

export function highlightToSafeHtml(text: string, language: string): string {
  const key =
    text.length <= HIGHLIGHT_CACHE_MAX_CHARS ? `${language}\u0000${text}` : "";
  const hit = key ? safeHtmlCache.get(key) : undefined;
  if (hit !== undefined) {
    safeHtmlCache.delete(key);
    safeHtmlCache.set(key, hit);
    return hit;
  }
  const html = DOMPurify.sanitize(highlightCode(text, language), {
    ALLOWED_TAGS: ["span", "br"],
    ALLOWED_ATTR: ["class"],
  });
  if (key) {
    safeHtmlCache.set(key, html);
    if (safeHtmlCache.size > HIGHLIGHT_CACHE_MAX_ENTRIES) {
      const oldest = safeHtmlCache.keys().next().value;
      if (oldest !== undefined) safeHtmlCache.delete(oldest);
    }
  }
  return html;
}

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
