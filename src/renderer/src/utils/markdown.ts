import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
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
export function parseMarkdownRaw(content: string): string {
  return marked.parse(content || "", { async: false }) as string;
}
