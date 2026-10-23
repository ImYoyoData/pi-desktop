import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { ComposerChip } from "@renderer/stores/composer";
import { truncateElementContent, useComposerStore } from "@renderer/stores/composer";
import { fileTagLabel, urlTagLabel } from "@renderer/utils/composer-tags";
import {
  draftBeforeCaret,
  needsLeadingSpace,
  normalizeInsertedText,
  serializeRichEditor,
} from "@renderer/utils/composer-rich";
import { isRegionCitation } from "../../../shared/protocol";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ComposerRichEditor.module.css";

export type ComposerRichEditorHandle = {
  focus: () => void;
  focusEnd: () => void;
  isCaretAtEnd: () => boolean;
  getSurface: () => HTMLDivElement | null;
  appendTextAtEnd: (text: string, separate?: boolean) => void;
  insertTextAtCaret: (text: string, separate?: boolean) => void;
  scrollToEnd: () => void;
};

export type ComposerRichEditorProps = {
  disabled?: boolean;
  expanded?: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  onClick?: (event: MouseEvent) => void;
  onInput?: () => void;
};

export const ComposerRichEditor = forwardRef<
  ComposerRichEditorHandle,
  ComposerRichEditorProps
>(function ComposerRichEditor(
  { disabled, expanded, onKeyDown, onKeyUp, onClick, onInput },
  ref,
): ReactNode {
  const t = useI18n();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  /** True while applying store → DOM so input/watchers do not loop. */
  const applyingRef = useRef(false);

  const draft = useComposerStore((s) => s.draft);
  const chips = useComposerStore((s) => s.chips);
  const activeSessionId = useComposerStore((s) => s.activeSessionId);

  const placeholder = chips.length ? "" : t.composerPlaceholder;
  const isEmpty = !draft.trim() && chips.length === 0;
  const chipsKey = chips.map((c) => c.id).join("|");

  function chipLabel(chip: ComposerChip): string {
    if (chip.kind === "file") {
      const range =
        chip.startLine && chip.endLine
          ? `:${chip.startLine}-${chip.endLine}`
          : chip.startLine
            ? `:${chip.startLine}`
            : "";
      return `${fileTagLabel(chip.path)}${range}`;
    }
    if (chip.kind === "url") return urlTagLabel(chip.url);
    const content = truncateElementContent(chip.citation.text ?? "", 100);
    if (isRegionCitation(chip.citation)) return t.chipRegion;
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
      useComposerStore.getState().removeChip(chip.id);
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

  function syncDraftFromDom(): void {
    const root = surfaceRef.current;
    if (!root || applyingRef.current) return;
    const { draft: nextDraft, chipOrder } = serializeRichEditor(root);
    applyingRef.current = true;
    useComposerStore.getState().setDraft(nextDraft);
    // Chips deleted via backspace/native contenteditable — drop from store
    for (const chip of [...useComposerStore.getState().chips]) {
      if (!chipOrder.includes(chip.id)) {
        useComposerStore.getState().removeChip(chip.id);
      }
    }
    applyingRef.current = false;
  }

  function rebuildFromStore(): void {
    const root = surfaceRef.current;
    if (!root) return;
    const state = useComposerStore.getState();
    applyingRef.current = true;
    root.replaceChildren();

    // Chips first, then draft text — typing appends after tags.
    for (const chip of state.chips) {
      if (root.childNodes.length > 0) {
        root.appendChild(document.createTextNode(" "));
      }
      root.appendChild(createChipEl(chip));
    }

    const draftText = state.draft;
    if (draftText) {
      if (root.childNodes.length > 0) {
        root.appendChild(document.createTextNode(" "));
      }
      const lines = draftText.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) root.appendChild(document.createElement("br"));
        const line = lines[i] ?? "";
        if (line) root.appendChild(document.createTextNode(line));
      }
    }

    if (!root.lastChild || root.lastChild.nodeType !== Node.TEXT_NODE) {
      root.appendChild(document.createTextNode("\u200B"));
    }
    applyingRef.current = false;
  }

  /** Append plain text after chips / existing content, sync draft, scroll into view. */
  function appendTextAtEnd(text: string, separate = false): void {
    const root = surfaceRef.current;
    const next = normalizeInsertedText(text);
    if (!root || !next) return;

    applyingRef.current = true;
    // Drop trailing zero-width spacer so we do not nest junk
    const last = root.lastChild;
    if (
      last &&
      last.nodeType === Node.TEXT_NODE &&
      (last.textContent === "\u200B" || last.textContent === "")
    ) {
      last.remove();
    }

    const before = serializeRichEditor(root).draft;
    if (separate && root.childNodes.length > 0 && needsLeadingSpace(before, next)) {
      root.appendChild(document.createTextNode(" "));
    }
    const lines = next.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) root.appendChild(document.createElement("br"));
      const line = lines[i] ?? "";
      if (line) root.appendChild(document.createTextNode(line));
    }
    root.appendChild(document.createTextNode("\u200B"));
    applyingRef.current = false;
    syncDraftFromDom();
    focusEnd();
    scrollToEnd();
  }

  function scrollCaretIntoView(): void {
    // Ensure the caret line is visible inside the scrollport
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const node = sel.getRangeAt(0).endContainer;
        const el =
          node.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : node.parentElement;
        el?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    } catch {
      // ignore
    }
  }

  function scrollToEnd(): void {
    const root = surfaceRef.current;
    if (!root) return;
    root.scrollTop = root.scrollHeight;
    scrollCaretIntoView();
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /**
   * 走原生 insertHTML 命令插入纯文本，浏览器才会把它记进 undo 栈，
   * Ctrl+Z 因而能撤回粘贴内容；命令不可用时返回 false，由调用方退回 DOM 拼接。
   * `separate` 为真时按拖放语义补一个分隔空格，粘贴不补。
   */
  function insertTextViaCommand(next: string, before: string, separate: boolean): boolean {
    const payload = separate && needsLeadingSpace(before, next) ? ` ${next}` : next;
    const html = escapeHtml(payload).replace(/\n/g, "<br>");
    try {
      return document.execCommand("insertHTML", false, html);
    } catch {
      return false;
    }
  }

  /** 程序化 DOM 拼接：多行必须拆成真实 <br>，否则 contenteditable 会吞掉 \n。 */
  function insertTextViaDom(range: Range, next: string, before: string, separate: boolean): void {
    range.deleteContents();
    if (separate && needsLeadingSpace(before, next)) {
      range.insertNode(document.createTextNode(" "));
      const sp = document.createTextNode("\u200B");
      range.insertNode(sp);
      range.setStartAfter(sp);
      range.collapse(true);
      sp.remove();
    }
    const lines = next.split("\n");
    let lastInserted: Node | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        const br = document.createElement("br");
        range.insertNode(br);
        range.setStartAfter(br);
        range.collapse(true);
        lastInserted = br;
      }
      const line = lines[i] ?? "";
      if (!line) continue;
      const node = document.createTextNode(line);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      lastInserted = node;
    }
    const spacer = document.createTextNode("\u200B");
    if (lastInserted) {
      range.setStartAfter(lastInserted);
      range.collapse(true);
    }
    range.insertNode(spacer);
    placeCaretAfter(spacer);
  }

  /**
   * Insert plain text at the current selection; a highlighted range inside the
   * surface is replaced in place. Falls back to the end of the editor when no
   * selection lives inside the surface (e.g. the editor lost focus).
   * `separate` 仅拖放使用：插入点前有文字时补一个分隔空格。粘贴逐字插入，
   * 首尾空白与内容必须原样落到输入框，不做任何改写。
   */
  function insertTextAtCaret(text: string, separate = false): void {
    const root = surfaceRef.current;
    const next = normalizeInsertedText(text);
    if (!root || !next) return;

    root.focus();
    const sel = window.getSelection();
    const range =
      sel &&
      sel.rangeCount > 0 &&
      root.contains(sel.getRangeAt(0).commonAncestorContainer)
        ? sel.getRangeAt(0)
        : null;

    if (!range) {
      appendTextAtEnd(next, separate);
      return;
    }

    const before = draftBeforeCaret(root, range);
    applyingRef.current = true;
    if (!insertTextViaCommand(next, before, separate)) {
      insertTextViaDom(range, next, before, separate);
    }
    applyingRef.current = false;
    syncDraftFromDom();
    // 就地粘贴要把视图留在插入点，不要跳到底部。
    scrollCaretIntoView();
  }

  function syncChipsFromStore(): void {
    const root = surfaceRef.current;
    if (!root || applyingRef.current) return;

    const state = useComposerStore.getState();
    const storeIds = new Set(state.chips.map((c) => c.id));

    for (const node of Array.from(root.querySelectorAll("[data-chip-id]"))) {
      const el = node as HTMLElement;
      const id = el.getAttribute("data-chip-id");
      if (id && !storeIds.has(id)) {
        el.remove();
      }
    }

    for (const chip of state.chips) {
      if (!findChipEl(root, chip.id)) {
        // Append new chips at the END of the editor (stable position), never at
        // the caret — the caret may be mid-text and a chip there would jump
        // around as more chips arrive.
        root.appendChild(createChipEl(chip));
      }
    }
    // Keep the caret usable: after appending chips, ensure focus stays in the
    // editor so typing continues (appendNode itself does not steal focus).
  }

  function normalizeDraft(s: string): string {
    return s.replace(/\u200B/g, "").replace(/\u00A0/g, " ");
  }

  function focus(): void {
    surfaceRef.current?.focus();
  }

  function focusEnd(): void {
    const root = surfaceRef.current;
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
    const root = surfaceRef.current;
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
    return surfaceRef.current;
  }

  function chipBeforeCaret(): HTMLElement | null {
    const root = surfaceRef.current;
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
      let prev: ChildNode | null = root.childNodes[startOffset - 1] ?? null;
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

  const handleInput = useCallback((): void => {
    syncDraftFromDom();
    onInput?.();
  }, [onInput]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (disabled) {
        e.preventDefault();
        return;
      }

      if (e.key === "Backspace" && !e.nativeEvent.isComposing) {
        const chip = chipBeforeCaret();
        if (chip) {
          const id = chip.getAttribute("data-chip-id");
          if (id) {
            e.preventDefault();
            useComposerStore.getState().removeChip(id);
            onKeyDown?.(e.nativeEvent);
            return;
          }
        }
      }

      onKeyDown?.(e.nativeEvent);
    },
    [disabled, onKeyDown],
  );

  const handleKeyUp = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      onKeyUp?.(e.nativeEvent);
    },
    [onKeyUp],
  );

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      onClick?.(e.nativeEvent);
    },
    [onClick],
  );

  useEffect(() => {
    rebuildFromStore();
  }, [activeSessionId]);

  useEffect(() => {
    if (applyingRef.current) return;
    const root = surfaceRef.current;
    if (!root) return;
    const domDraft = serializeRichEditor(root).draft;
    if (normalizeDraft(domDraft) === normalizeDraft(draft)) return;
    // External draft change (queue load) — rebuild chips + text
    rebuildFromStore();
  }, [draft]);

  useEffect(() => {
    if (applyingRef.current) return;
    syncChipsFromStore();
    // Keep draft in sync if chip removal left spacer text only changes
    syncDraftFromDom();
  }, [chipsKey]);

  useImperativeHandle(
    ref,
    () => ({
      focus,
      focusEnd,
      isCaretAtEnd,
      getSurface,
      appendTextAtEnd,
      insertTextAtCaret,
      scrollToEnd,
    }),
    [],
  );

  return (
    <div className={`${styles.richWrap} ${expanded ? styles.isExpanded : ""}`}>
      {isEmpty && placeholder ? (
        <div className={styles.richPlaceholder} aria-hidden="true">
          {placeholder}
        </div>
      ) : null}
      <div
        ref={surfaceRef}
        className={`${styles.richSurface} ${disabled ? styles.isDisabled : ""}`}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder || undefined}
        spellCheck
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleClick}
      />
    </div>
  );
});

export default ComposerRichEditor;
