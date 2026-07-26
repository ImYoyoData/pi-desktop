<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import hljs from "highlight.js/lib/common";
import { useDialog } from "naive-ui";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useLayoutStore } from "@renderer/stores/layout";

const props = defineProps<{
  content: string;
}>();

const rootEl = ref<HTMLElement | null>(null);
const dialog = useDialog();
const rightTabs = useRightTabsStore();
const layout = useLayoutStore();

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || "").trim().split(/\s+/)[0] || "";
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
        `<button type="button" class="copy-btn" data-copy>复制</button></div>`,
        `<div class="code-body"><div class="line-nos" aria-hidden="true">${nos}</div>`,
        `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`,
        `</div></div>`,
      ].join("");
    },
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${t} rel="noopener noreferrer">${text}</a>`;
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

function renderHtml(content: string): string {
  const raw = marked.parse(content || "", { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["data-copy", "data-code-block", "target", "rel"],
    ADD_TAGS: ["button"],
  });
}

const html = ref(renderHtml(props.content));

watch(
  () => props.content,
  (c) => {
    html.value = renderHtml(c);
  },
);

function openInBuiltinBrowser(url: string): void {
  rightTabs.addTab("browser");
  window.dispatchEvent(new CustomEvent("pi-browser-navigate", { detail: { url } }));
  if (layout.rightCollapsed) layout.toggleRightCollapsed();
}

function onRootClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const copyBtn = target.closest("[data-copy]") as HTMLElement | null;
  if (copyBtn) {
    event.preventDefault();
    const block = copyBtn.closest("[data-code-block]");
    const code = block?.querySelector("code")?.textContent ?? "";
    void navigator.clipboard.writeText(code).then(() => {
      copyBtn.textContent = "已复制";
      setTimeout(() => {
        copyBtn.textContent = "复制";
      }, 1200);
    });
    return;
  }

  const anchor = target.closest("a") as HTMLAnchorElement | null;
  if (!anchor || !anchor.href) return;
  event.preventDefault();
  const url = anchor.href;
  if (!/^https?:\/\//i.test(url)) return;

  if (event.ctrlKey || event.metaKey) {
    dialog.warning({
      title: "打开外部浏览器",
      content: `是否用系统浏览器打开？\n${url}`,
      positiveText: "打开",
      negativeText: "取消",
      onPositiveClick: () => {
        void window.api.browser.openExternal(url);
      },
    });
    return;
  }

  openInBuiltinBrowser(url);
}

onMounted(() => {
  rootEl.value?.addEventListener("click", onRootClick);
});

onUnmounted(() => {
  rootEl.value?.removeEventListener("click", onRootClick);
});
</script>

<template>
  <div ref="rootEl" class="md" v-html="html" />
</template>

<style>
@import "highlight.js/styles/github.css";
</style>

<style scoped>
.md {
  font-size: 14px;
  line-height: 1.55;
  color: inherit;
  word-break: break-word;
}

.md :deep(p) {
  margin: 0 0 0.65em;
}

.md :deep(p:last-child) {
  margin-bottom: 0;
}

.md :deep(ul),
.md :deep(ol) {
  margin: 0 0 0.65em;
  padding-left: 1.35em;
}

.md :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.md :deep(.code-block) {
  margin: 0.6em 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: #f6f8fa;
}

.md :deep(.code-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: #eef1f4;
  font-size: 11px;
  color: var(--fg-muted);
}

.md :deep(.copy-btn) {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
  color: var(--fg-muted);
}

.md :deep(.copy-btn:hover) {
  color: var(--fg-strong);
}

.md :deep(.code-body) {
  display: grid;
  grid-template-columns: auto 1fr;
  max-height: 420px;
  overflow: auto;
}

.md :deep(.line-nos) {
  padding: 10px 0;
  background: #eef1f4;
  border-right: 1px solid var(--border);
  text-align: right;
  user-select: none;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg-faint);
}

.md :deep(.line-nos span) {
  display: block;
  padding: 0 8px;
}

.md :deep(pre) {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  background: transparent;
}

.md :deep(code.hljs) {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  background: transparent;
  padding: 0;
}

.md :deep(:not(pre) > code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
}
</style>
