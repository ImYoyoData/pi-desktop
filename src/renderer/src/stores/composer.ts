import { defineStore } from "pinia";
import { ref } from "vue";
import type { ElementCitation } from "../../../shared/protocol";
import { truncateHtmlSnippet } from "../../../shared/html-snippet";

export type ComposerChip =
  | { id: string; kind: "element"; citation: ElementCitation }
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "url"; url: string };

function chipId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isHttpUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const useComposerStore = defineStore("composer", () => {
  const draft = ref("");
  const chips = ref<ComposerChip[]>([]);

  /** @deprecated prefer chips; kept as computed-like accessor for element citations */
  function elementCitations(): ElementCitation[] {
    return chips.value
      .filter((c): c is Extract<ComposerChip, { kind: "element" }> => c.kind === "element")
      .map((c) => c.citation);
  }

  function addCitation(citation: ElementCitation): void {
    chips.value = [
      ...chips.value,
      {
        id: chipId(),
        kind: "element",
        citation: {
          ...citation,
          htmlSnippet: truncateHtmlSnippet(citation.htmlSnippet),
          screenshotDataUrl: citation.screenshotDataUrl,
        },
      },
    ];
  }

  function addFileTag(filePath: string): void {
    const path = filePath.trim();
    if (!path) return;
    if (chips.value.some((c) => c.kind === "file" && c.path === path)) return;
    chips.value = [...chips.value, { id: chipId(), kind: "file", path }];
  }

  function addUrlTag(url: string): void {
    const normalized = url.trim();
    if (!isHttpUrl(normalized)) return;
    if (chips.value.some((c) => c.kind === "url" && c.url === normalized)) return;
    chips.value = [...chips.value, { id: chipId(), kind: "url", url: normalized }];
  }

  function removeChip(id: string): void {
    chips.value = chips.value.filter((c) => c.id !== id);
  }

  function clear(): void {
    draft.value = "";
    chips.value = [];
  }

  /** Legacy name — now adds a file tag chip instead of plain text. */
  function insertPathRef(filePath: string): void {
    addFileTag(filePath);
  }

  function formatChipsForMessage(): string {
    const parts: string[] = [];
    for (const chip of chips.value) {
      if (chip.kind === "file") {
        const ref = chip.path.includes(" ") ? `"${chip.path}"` : chip.path;
        parts.push(`@${ref}`);
      } else if (chip.kind === "url") {
        parts.push(chip.url);
      }
    }
    return parts.join(" ");
  }

  return {
    draft,
    chips,
    elementCitations,
    addCitation,
    addFileTag,
    addUrlTag,
    removeChip,
    clear,
    insertPathRef,
    formatChipsForMessage,
  };
});
