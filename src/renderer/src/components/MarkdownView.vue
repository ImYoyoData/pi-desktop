<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { NModal, NButton, NSpace, useDialog, useMessage } from "naive-ui";
import { renderMarkdown, setMarkdownCopyLabel } from "@renderer/utils/markdown";
import {
  applyDiagramZoom,
  clampDiagramZoom,
  getDiagramSource,
  getDiagramSvgMarkup,
  handleDiagramToolClick,
  readDiagramZoom,
  type DiagramToolLabels,
} from "@renderer/utils/diagram-chrome";
import { mountDotIn } from "@renderer/utils/dot-render";
import { mountMermaidIn, resetMermaidForTheme } from "@renderer/utils/mermaid-render";
import { handleAppLinkClick } from "@renderer/utils/open-link";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { t } from "@renderer/i18n";

const props = defineProps<{
  content: string;
}>();

const rootEl = ref<HTMLElement | null>(null);
const dialog = useDialog();
const message = useMessage();
const appearance = useAppearanceStore();

const previewOpen = ref(false);
const previewZoom = ref(1);
const previewSvg = ref("");
const previewSource = ref("");
const previewKind = ref("diagram");

const diagramLabels = computed<DiagramToolLabels>(() => ({
  zoomIn: t.mdDiagramZoomIn,
  zoomOut: t.mdDiagramZoomOut,
  zoomReset: t.mdDiagramZoomReset,
  expand: t.mdDiagramExpand,
  copySource: t.mdDiagramCopySource,
  downloadSvg: t.mdDiagramDownloadSvg,
}));

setMarkdownCopyLabel(t.copy);

function refreshHtml(content: string): string {
  setMarkdownCopyLabel(t.copy);
  return renderMarkdown(content);
}

const html = ref(refreshHtml(props.content));
let diagramTimer = 0;

function scheduleDiagrams(): void {
  if (diagramTimer) window.clearTimeout(diagramTimer);
  diagramTimer = window.setTimeout(() => {
    diagramTimer = 0;
    void paintDiagrams();
  }, 140);
}

async function paintDiagrams(): Promise<void> {
  await nextTick();
  const root = rootEl.value;
  if (!root) return;
  const labels = diagramLabels.value;
  await Promise.all([
    mountMermaidIn(root, appearance.resolvedTheme === "dark", labels),
    mountDotIn(root, labels),
  ]);
}

function openPreview(block: HTMLElement): void {
  previewSvg.value = getDiagramSvgMarkup(block);
  previewSource.value = getDiagramSource(block);
  previewKind.value =
    block.getAttribute("data-diagram") ||
    block.querySelector(".md-diagram-kind")?.textContent?.trim() ||
    "diagram";
  previewZoom.value = Math.max(1, readDiagramZoom(block));
  previewOpen.value = Boolean(previewSvg.value);
}

function onPreviewWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  nudgePreviewZoom(factor);
}

function onRootClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const toolBtn = target.closest("[data-diagram-action]") as HTMLElement | null;
  if (toolBtn) {
    event.preventDefault();
    event.stopPropagation();
    const block = toolBtn.closest(".md-diagram") as HTMLElement | null;
    if (!block) return;
    const action = toolBtn.getAttribute("data-diagram-action") || "";
    const result = handleDiagramToolClick(block, action);
    if (result === "expand") openPreview(block);
    if (result === "copied") message.success(t.copied);
    if (result === "downloaded") message.success(t.mdDiagramDownloaded);
    return;
  }

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
  handleAppLinkClick(event, anchor.href, dialog);
}

function onRootWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  const target = event.target as HTMLElement | null;
  const block = target?.closest?.(".md-diagram.md-diagram-ready") as HTMLElement | null;
  if (!block) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  applyDiagramZoom(block, readDiagramZoom(block) * factor);
}

function nudgePreviewZoom(factor: number): void {
  previewZoom.value = clampDiagramZoom(previewZoom.value * factor);
}

function resetPreviewZoom(): void {
  previewZoom.value = 1;
}

function copyPreviewSource(): void {
  if (!previewSource.value) return;
  void navigator.clipboard.writeText(previewSource.value).then(() => {
    message.success(t.copied);
  });
}

function downloadPreviewSvg(): void {
  if (!previewSvg.value) return;
  const blob = new Blob([previewSvg.value], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `diagram-${Date.now()}.svg`;
  a.click();
  URL.revokeObjectURL(url);
  message.success(t.mdDiagramDownloaded);
}

watch(
  () => props.content,
  (c) => {
    html.value = refreshHtml(c);
    scheduleDiagrams();
  },
);

watch(
  () => appearance.resolvedTheme,
  () => {
    // Theme only affects Mermaid — avoid full markdown re-parse of every message.
    const root = rootEl.value;
    if (root) resetMermaidForTheme(root);
    scheduleDiagrams();
  },
);

onMounted(() => {
  rootEl.value?.addEventListener("click", onRootClick);
  rootEl.value?.addEventListener("wheel", onRootWheel, { passive: false });
  scheduleDiagrams();
});

onUnmounted(() => {
  if (diagramTimer) window.clearTimeout(diagramTimer);
  rootEl.value?.removeEventListener("click", onRootClick);
  rootEl.value?.removeEventListener("wheel", onRootWheel);
});
</script>

<template>
  <div ref="rootEl" class="md" v-html="html" />

  <NModal
    v-model:show="previewOpen"
    preset="card"
    :title="t.mdDiagramPreviewTitle(previewKind)"
    class="pi-settings-modal diagram-fullscreen-modal"
    style="width: min(100vw, 100%); max-width: 100vw"
    :bordered="false"
    size="huge"
  >
    <div class="modal-scroll preview-shell">
      <div class="preview-toolbar">
        <NSpace :size="6" align="center">
          <NButton size="tiny" @click="nudgePreviewZoom(1 / 1.2)">−</NButton>
          <span class="preview-zoom">{{ Math.round(previewZoom * 100) }}%</span>
          <NButton size="tiny" @click="nudgePreviewZoom(1.2)">+</NButton>
          <NButton size="tiny" @click="resetPreviewZoom">1:1</NButton>
          <NButton size="tiny" @click="copyPreviewSource">{{ t.mdDiagramCopySource }}</NButton>
          <NButton size="tiny" @click="downloadPreviewSvg">{{ t.mdDiagramDownloadSvg }}</NButton>
          <span class="preview-hint">{{ t.mdDiagramFullscreenHint }}</span>
        </NSpace>
      </div>
      <div class="preview-viewport" @wheel="onPreviewWheel">
        <div
          class="preview-canvas"
          :style="{ transform: `scale(${previewZoom})` }"
          v-html="previewSvg"
        />
      </div>
    </div>
  </NModal>
</template>

<style>
@import "katex/dist/katex.min.css";
</style>

<style scoped>
/* Global base.css resets ul list-style and * font-weight — restore GFM chrome here. */
.md {
  font-size: 16px;
  line-height: 1.75;
  color: inherit;
  word-break: break-word;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
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

.md :deep(blockquote) {
  margin: 0.65em 0;
  padding: 0.15em 0 0.15em 0.85em;
  border-left: 3px solid var(--border-strong, rgba(127, 127, 127, 0.45));
  color: var(--fg-muted);
}

.md :deep(hr) {
  margin: 1em 0;
  border: none;
  border-top: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
}

.md :deep(a) {
  color: var(--accent, #3b82f6);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.md :deep(.md-table-scroll) {
  overflow-x: auto;
  margin: 0.65em 0;
}

.md :deep(table) {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 13px;
}

.md :deep(th),
.md :deep(td) {
  border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.3));
  padding: 6px 10px;
  text-align: left;
}

.md :deep(th) {
  background: var(--bg-elevated, rgba(127, 127, 127, 0.08));
  font-weight: 600;
}

.md :deep(.code-block) {
  margin: 0.75em 0;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
  overflow: hidden;
  background: var(--pre-bg, var(--code-bg, var(--bg-elevated, transparent)));
}

.md :deep(.code-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.2));
  font-size: 11px;
  color: var(--fg-faint);
}

.md :deep(.copy-btn) {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}

.md :deep(.copy-btn:hover) {
  background: rgba(127, 127, 127, 0.12);
  color: var(--fg);
}

.md :deep(.code-body) {
  display: flex;
  align-items: flex-start;
  max-height: 420px;
  /* Single scrollport so line numbers and code stay locked together. */
  overflow: auto;
}

.md :deep(.line-nos) {
  flex: 0 0 auto;
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 10px 0;
  text-align: right;
  user-select: none;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg-faint);
  background: var(--pre-bg, var(--code-bg, var(--bg-elevated, transparent)));
}

.md :deep(.line-nos span) {
  display: block;
  padding: 0 8px;
}

/* Do not give <pre> its own scrollbar — that desyncs .line-nos (issue #6). */
.md :deep(.code-body > pre) {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: visible;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.md :deep(code.hljs) {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  background: transparent;
  padding: 0;
  white-space: pre;
}

.md :deep(:not(pre) > code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--md-inline-code-bg, rgba(0, 0, 0, 0.06));
}

.md :deep(.md-diagram) {
  margin: 0.75em 0;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
  background: var(--bg-elevated, transparent);
  overflow: hidden;
}

.md :deep(.md-diagram-toolbar) {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.2));
  font-size: 11px;
  color: var(--fg-faint);
}

.md :deep(.md-diagram-kind) {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}

.md :deep(.md-diagram-spacer) {
  flex: 1;
}

.md :deep(.md-diagram-zoom) {
  min-width: 40px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.md :deep(.md-diagram-btn) {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
}

.md :deep(.md-diagram-btn:hover) {
  background: rgba(127, 127, 127, 0.14);
  color: var(--fg);
}

.md :deep(.md-diagram-viewport) {
  overflow: auto;
  max-height: min(70vh, 640px);
  padding: 12px;
  cursor: grab;
}

.md :deep(.md-diagram-canvas) {
  transform-origin: top left;
  width: max-content;
  margin: 0 auto;
}

.md :deep(.md-diagram-canvas svg) {
  display: block;
  max-width: none;
  height: auto;
}

.md :deep(.md-diagram-src) {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  background: transparent;
}

.md :deep(.md-diagram-error .md-diagram-src) {
  opacity: 0.9;
}

.md :deep(.md-diagram-error-msg) {
  margin: 0;
  padding: 6px 10px 10px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--error, #d03050);
  white-space: pre-wrap;
  word-break: break-word;
}

.md :deep(.md-math-block) {
  margin: 0.75em 0;
  overflow-x: auto;
  text-align: center;
}

.md :deep(.katex-display) {
  margin: 0.5em 0;
}

.preview-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: min(86vh, 900px);
}

.preview-toolbar {
  margin-bottom: 0;
  flex-shrink: 0;
}

.preview-hint {
  margin-left: 8px;
  font-size: 11px;
  color: var(--fg-faint);
}

.preview-zoom {
  display: inline-flex;
  align-items: center;
  min-width: 44px;
  justify-content: center;
  font-size: 12px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.preview-viewport {
  flex: 1;
  overflow: auto;
  min-height: min(78vh, 820px);
  max-height: min(82vh, 880px);
  padding: 20px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
  background: var(--bg-elevated, transparent);
  cursor: grab;
}

.preview-canvas {
  transform-origin: top left;
  width: max-content;
  margin: 0 auto;
}

.preview-canvas :deep(svg) {
  display: block;
  max-width: none;
  height: auto;
}
</style>

<style>
.diagram-fullscreen-modal.n-card,
.diagram-fullscreen-modal.n-modal {
  width: min(100vw - 16px, 1400px) !important;
  max-width: 100vw !important;
}
</style>
