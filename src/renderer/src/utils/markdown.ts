import DOMPurify from "dompurify";
import { marked } from "marked";
import hljs from "highlight.js/lib/common";

let copyButtonLabel = "Copy";

/** Update copy button label (i18n). Safe to call from Vue setup. */
export function setMarkdownCopyLabel(label: string): void {
  copyButtonLabel = label || "Copy";
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || "").trim().split(/\s+/)[0] || "";
      if (language.toLowerCase() === "mermaid") {
        const source = text.replace(/\n$/, "");
        return [
          `<div class="md-mermaid" data-mermaid>`,
          `<pre class="md-mermaid-src">${escapeHtml(source)}</pre>`,
          `</div>`,
        ].join("");
      }
      let highlighted = "";
      try {
        highlighted =
          language && hljs.getLanguage(language)
            ? hljs.highlight(text, { language }).value
            : hljs.highlightAuto(text).value;
      } catch {
        highlighted = escapeHtml(text);
      }
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
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titleAttr} rel="noopener noreferrer">${text}</a>`;
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

function wrapTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    return `<div class="md-table-scroll">${table}</div>`;
  });
}

/** Parse GFM markdown → sanitized HTML for chat bubbles. */
export function renderMarkdown(content: string): string {
  const raw = marked.parse(content || "", { async: false }) as string;
  return DOMPurify.sanitize(wrapTables(raw), {
    ADD_TAGS: ["button", "input"],
    ADD_ATTR: [
      "data-copy",
      "data-code-block",
      "data-mermaid",
      "target",
      "rel",
      "type",
      "checked",
      "disabled",
      "class",
    ],
  });
}

/** Pure marked output for unit tests (no DOMPurify / window). */
export function parseMarkdownRaw(content: string): string {
  return marked.parse(content || "", { async: false }) as string;
}
