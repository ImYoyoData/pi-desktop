<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useDialog } from "naive-ui";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useLayoutStore } from "@renderer/stores/layout";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { renderMarkdown, setMarkdownCopyLabel } from "@renderer/utils/markdown";
import { t } from "@renderer/i18n";

const props = defineProps<{
  content: string;
}>();

const rootEl = ref<HTMLElement | null>(null);
const dialog = useDialog();
const rightTabs = useRightTabsStore();
const layout = useLayoutStore();
const browserNav = useBrowserNavStore();

setMarkdownCopyLabel(t.copy);

function refreshHtml(content: string): string {
  setMarkdownCopyLabel(t.copy);
  return renderMarkdown(content);
}

const html = ref(refreshHtml(props.content));

watch(
  () => props.content,
  (c) => {
    html.value = refreshHtml(c);
  },
);

function openInBuiltinBrowser(url: string): void {
  // Reuse an existing browser tab so link clicks don't spawn blank tabs.
  const active = rightTabs.activeTab;
  const existing =
    (active?.kind === "browser" ? active : null) ??
    rightTabs.tabs.find((t) => t.kind === "browser") ??
    null;
  let tab = existing;
  if (tab) {
    rightTabs.selectTab(tab.id);
  } else {
    tab = rightTabs.addTab("browser");
  }
  // Store pending URL — BrowserTab consumes after mount / when visible.
  // Do not dispatch a window event here (race: new tab not listening yet).
  browserNav.requestNavigate(url, tab.id);
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
      copyBtn.textContent = t.copied;
      setTimeout(() => {
        copyBtn.textContent = t.copy;
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
      title: t.openExternalBrowser,
      content: t.openExternalBrowserConfirm(url),
      positiveText: t.open,
      negativeText: t.cancel,
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
/* Global base.css resets ul list-style and * font-weight — restore GFM chrome here. */
.md {
  font-size: 14px;
  line-height: 1.55;
  color: inherit;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.md :deep(p) {
  margin: 0 0 0.65em;
}

.md :deep(p:last-child) {
  margin-bottom: 0;
}

.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4),
.md :deep(h5),
.md :deep(h6) {
  margin: 1em 0 0.45em;
  line-height: 1.3;
  color: var(--fg-strong);
  font-weight: 650;
}

.md :deep(h1) {
  font-size: 1.45em;
}
.md :deep(h2) {
  font-size: 1.28em;
}
.md :deep(h3) {
  font-size: 1.14em;
}
.md :deep(h4),
.md :deep(h5),
.md :deep(h6) {
  font-size: 1em;
}

.md :deep(h1:first-child),
.md :deep(h2:first-child),
.md :deep(h3:first-child),
.md :deep(h4:first-child) {
  margin-top: 0;
}

.md :deep(strong),
.md :deep(b) {
  font-weight: 650;
  color: var(--fg-strong);
}

.md :deep(em),
.md :deep(i) {
  font-style: italic;
}

.md :deep(del),
.md :deep(s) {
  text-decoration: line-through;
  color: var(--fg-muted);
}

.md :deep(ul),
.md :deep(ol) {
  margin: 0 0 0.65em;
  padding-left: 1.5em;
}

.md :deep(ul) {
  list-style: disc outside;
}

.md :deep(ol) {
  list-style: decimal outside;
}

.md :deep(ul ul) {
  list-style: circle;
  margin-bottom: 0;
}

.md :deep(ul ul ul) {
  list-style: square;
}

.md :deep(ol ol) {
  list-style: lower-alpha;
  margin-bottom: 0;
}

.md :deep(li) {
  margin: 0.2em 0;
}

.md :deep(li > p) {
  margin: 0.2em 0;
}

.md :deep(li > ul),
.md :deep(li > ol) {
  margin: 0.15em 0 0.25em;
}

/* GFM task lists */
.md :deep(li:has(> input[type="checkbox"])) {
  list-style: none;
  margin-left: -1.25em;
  padding-left: 0.15em;
}

.md :deep(li > input[type="checkbox"]) {
  margin-right: 0.45em;
  vertical-align: middle;
}

.md :deep(blockquote) {
  margin: 0.5em 0 0.75em;
  padding: 0.15em 0 0.15em 0.85em;
  border-left: 3px solid var(--border-strong);
  color: var(--fg-muted);
}

.md :deep(blockquote p) {
  margin-bottom: 0.4em;
}

.md :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

.md :deep(hr) {
  margin: 1em 0;
  border: none;
  border-top: 1px solid var(--border);
}

.md :deep(.md-table-scroll) {
  margin: 0.65em 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.md :deep(table) {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 0;
}

.md :deep(.md-table-scroll table) {
  border: none;
  border-radius: 0;
}

.md :deep(thead) {
  background: var(--code-bg);
}

.md :deep(th),
.md :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}

.md :deep(th) {
  font-weight: 650;
  color: var(--fg-strong);
  white-space: nowrap;
}

.md :deep(tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--code-bg) 55%, transparent);
}

.md :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 0.4em 0;
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
  background: var(--pre-bg);
}

.md :deep(.code-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--code-bg);
  font-size: 11px;
  color: var(--fg-muted);
}

.md :deep(.copy-btn) {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
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
  background: var(--code-bg);
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
  background: var(--md-inline-code-bg, rgba(0, 0, 0, 0.06));
}
</style>
