<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { ComposerChip } from "@renderer/stores/composer";
import { truncateElementContent, useComposerStore } from "@renderer/stores/composer";
import { fileTagLabel } from "@renderer/utils/composer-tags";
import { serializeRichEditor } from "@renderer/utils/composer-rich";
import { t } from "@renderer/i18n";

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  keydown: [KeyboardEvent];
  keyup: [KeyboardEvent];
  click: [MouseEvent];
}>();

const composer = useComposerStore();
const surface = ref<HTMLDivElement | null>(null);

/** True while applying store → DOM so input/watchers do not loop. */
let applyingStore = false;

const placeholder = computed(() =>
  composer.chips.length ? "" : t.composerPlaceholder,
);

const isEmpty = computed(
  () => !composer.draft.trim() && composer.chips.length === 0,
);

function chipLabel(chip: ComposerChip): string {
  if (chip.kind === "file") return fileTagLabel(chip.path);
  if (chip.kind === "url") {
    try {
      const u = new URL(chip.url);
      const hostPath = `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
      return hostPath.length > 40 ? `${hostPath.slice(0, 40)}…` : hostPath;
    } catch {
      return chip.url.length > 40 ? `${chip.url.slice(0, 40)}…` : chip.url;
    }
  }
  const content = truncateElementContent(chip.citation.text ?? "", 100);
  if (content) return content;
  const sel = chip.citation.selector?.trim();
  if (sel) {
    const last = sel.split(">").pop()?.trim() || sel;
    return last.length > 36 ? `${last.slice(0, 36)}…` : last;
  }
  return t.chipElement;
}

function chipTitle(chip: ComposerChip): string {
  if (chip.kind === "file") return chip.path;
  if (chip.kind === "url") return chip.url;
  return [chip.citation.url, chip.citation.selector, chip.citation.text]
    .filter(Boolean)
    .join("\n");
}

function findChipEl(root: HTMLElement, id: string): HTMLElement | null {
  const nodes = root.querySelectorAll("[data-chip-id]");
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    if (el.getAttribute("data-chip-id") === id) return el;
  }
  return null;
}

function createChipEl(chip: ComposerChip): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.className = `chip chip-${chip.kind}`;
  span.setAttribute("data-chip-id", chip.id);
  span.setAttribute("data-chip-kind", chip.kind);
  span.title = chipTitle(chip);
  const label = document.createElement("span");
  label.className = "chip-label";
  label.textContent = chipLabel(chip);
  span.appendChild(label);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip-x";
  btn.setAttribute("aria-label", "remove");
  btn.textContent = "×";
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    composer.removeChip(chip.id);
  });
  span.appendChild(btn);
  return span;
}

function placeCaretAfter(node: Node): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function insertNodeAtCaret(node: Node): void {
  const root = surface.value;
  if (!root) return;
  root.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(node);
      const spacer = document.createTextNode("\u200B");
      range.setStartAfter(node);
      range.collapse(true);
      range.insertNode(spacer);
      placeCaretAfter(spacer);
      return;
    }
  }
  root.appendChild(node);
  const spacer = document.createTextNode("\u200B");
  root.appendChild(spacer);
  placeCaretAfter(spacer);
}

function syncDraftFromDom(): void {
  const root = surface.value;
  if (!root || applyingStore) return;
  const { draft, chipOrder } = serializeRichEditor(root);
  applyingStore = true;
  composer.draft = draft;
  // Chips deleted via backspace/native contenteditable — drop from store
  for (const chip of [...composer.chips]) {
    if (!chipOrder.includes(chip.id)) {
      composer.removeChip(chip.id);
    }
  }
  applyingStore = false;
}

function rebuildFromStore(): void {
  const root = surface.value;
  if (!root) return;
  applyingStore = true;
  root.replaceChildren();

  const draft = composer.draft;
  if (draft) {
    const lines = draft.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) root.appendChild(document.createElement("br"));
      const line = lines[i] ?? "";
      if (line) root.appendChild(document.createTextNode(line));
    }
  }

  for (const chip of composer.chips) {
    if (root.childNodes.length > 0) {
      root.appendChild(document.createTextNode(" "));
    }
    root.appendChild(createChipEl(chip));
  }

  if (!root.lastChild || root.lastChild.nodeType !== Node.TEXT_NODE) {
    root.appendChild(document.createTextNode("\u200B"));
  }
  applyingStore = false;
}

function syncChipsFromStore(): void {
  const root = surface.value;
  if (!root || applyingStore) return;

  const storeIds = new Set(composer.chips.map((c) => c.id));

  for (const node of Array.from(root.querySelectorAll("[data-chip-id]"))) {
    const el = node as HTMLElement;
    const id = el.getAttribute("data-chip-id");
    if (id && !storeIds.has(id)) {
      el.remove();
    }
  }

  for (const chip of composer.chips) {
    if (!findChipEl(root, chip.id)) {
      insertNodeAtCaret(createChipEl(chip));
    }
  }
}

function normalizeDraft(s: string): string {
  return s.replace(/\u200B/g, "").replace(/\u00A0/g, " ");
}

function focus(): void {
  surface.value?.focus();
}

function focusEnd(): void {
  const root = surface.value;
  if (!root) return;
  root.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function isCaretAtEnd(): boolean {
  const root = surface.value;
  if (!root) return true;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const range = sel.getRangeAt(0);
  const end = document.createRange();
  end.selectNodeContents(root);
  end.collapse(false);
  return range.compareBoundaryPoints(Range.START_TO_END, end) === 0;
}

function getSurface(): HTMLDivElement | null {
  return surface.value;
}

function chipBeforeCaret(): HTMLElement | null {
  const root = surface.value;
  const sel = window.getSelection();
  if (!root || !sel || !sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const { startContainer, startOffset } = range;

  if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
    let prev = startContainer.previousSibling;
    while (prev && prev.nodeType === Node.TEXT_NODE && !(prev.textContent ?? "").replace(/\u200B/g, "")) {
      prev = prev.previousSibling;
    }
    if (prev instanceof HTMLElement && prev.getAttribute("data-chip-id")) return prev;
  }

  if (startContainer === root && startOffset > 0) {
    let prev = root.childNodes[startOffset - 1] ?? null;
    while (prev && prev.nodeType === Node.TEXT_NODE && !(prev.textContent ?? "").replace(/\u200B/g, "")) {
      prev = prev.previousSibling;
    }
    if (prev instanceof HTMLElement && prev.getAttribute("data-chip-id")) return prev;
  }

  if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0) {
    const text = startContainer.textContent ?? "";
    const before = text.slice(0, startOffset).replace(/\u200B/g, "");
    if (!before) {
      let prev = startContainer.previousSibling;
      while (prev && prev.nodeType === Node.TEXT_NODE && !(prev.textContent ?? "").replace(/\u200B/g, "")) {
        prev = prev.previousSibling;
      }
      if (prev instanceof HTMLElement && prev.getAttribute("data-chip-id")) return prev;
    }
  }

  return null;
}

function onInput(): void {
  syncDraftFromDom();
}

function onKeydown(e: KeyboardEvent): void {
  if (props.disabled) {
    e.preventDefault();
    return;
  }

  if (e.key === "Backspace" && !e.isComposing) {
    const chip = chipBeforeCaret();
    if (chip) {
      const id = chip.getAttribute("data-chip-id");
      if (id) {
        e.preventDefault();
        composer.removeChip(id);
        emit("keydown", e);
        return;
      }
    }
  }

  emit("keydown", e);
}

function onKeyup(e: KeyboardEvent): void {
  emit("keyup", e);
}

function onClick(e: MouseEvent): void {
  emit("click", e);
}

onMounted(() => {
  rebuildFromStore();
});

watch(
  () => composer.activeSessionId,
  () => {
    void nextTick(() => rebuildFromStore());
  },
);

watch(
  () => composer.chips.map((c) => c.id).join("|"),
  () => {
    if (applyingStore) return;
    syncChipsFromStore();
    // Keep draft in sync if chip removal left spacer text only changes
    syncDraftFromDom();
  },
);

watch(
  () => composer.draft,
  (draft) => {
    if (applyingStore) return;
    const root = surface.value;
    if (!root) return;
    const domDraft = serializeRichEditor(root).draft;
    if (normalizeDraft(domDraft) === normalizeDraft(draft)) return;
    // External draft change (ASR / queue load) — rebuild chips + text
    rebuildFromStore();
  },
);

defineExpose({
  focus,
  focusEnd,
  isCaretAtEnd,
  getSurface,
});
</script>

<template>
  <div class="rich-wrap">
    <div
      v-if="isEmpty && placeholder"
      class="rich-placeholder"
      aria-hidden="true"
    >
      {{ placeholder }}
    </div>
    <div
      ref="surface"
      class="rich-surface"
      :class="{ 'is-empty': isEmpty, 'is-disabled': disabled }"
      :contenteditable="disabled ? 'false' : 'true'"
      role="textbox"
      aria-multiline="true"
      :aria-placeholder="placeholder || undefined"
      spellcheck="true"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="onKeyup"
      @click="onClick"
    />
  </div>
</template>

<style scoped>
.rich-wrap {
  position: relative;
  width: 100%;
  min-width: 0;
}

/* Overlay only — must not affect editor layout/height when empty. */
.rich-placeholder {
  position: absolute;
  inset: 0;
  z-index: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
  font-size: 13px;
  line-height: 1.45;
  color: var(--fg-faint, #999);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rich-surface {
  position: relative;
  z-index: 1;
  min-height: 24px;
  max-height: calc(1.45em * 8 + 8px);
  overflow-y: auto;
  width: 100%;
  min-width: 0;
  outline: none;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg-strong, inherit);
  user-select: text;
  -webkit-user-select: text;
}

.rich-surface.is-disabled {
  opacity: 0.65;
  cursor: default;
}

.rich-surface :deep(.chip) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 200px;
  margin: 1px 2px;
  padding: 0 6px 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--primary, #3b82f6) 28%, var(--border, #ddd));
  background: color-mix(in srgb, var(--primary, #3b82f6) 12%, transparent);
  color: var(--fg-strong, #222);
  font-size: 11px;
  line-height: 1.6;
  vertical-align: middle;
  user-select: none;
  cursor: default;
  white-space: nowrap;
  overflow: hidden;
}

.rich-surface :deep(.chip-label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rich-surface :deep(.chip-file) {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.rich-surface :deep(.chip-x) {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--fg-muted, #666);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.rich-surface :deep(.chip-x:hover) {
  background: rgba(0, 0, 0, 0.08);
  color: var(--fg-strong, #222);
}
</style>
