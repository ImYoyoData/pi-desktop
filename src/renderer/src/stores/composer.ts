import { defineStore } from "pinia";
import { ref } from "vue";
import type { ElementCitation } from "../../../shared/protocol";
import { truncateHtmlSnippet } from "../../../shared/html-snippet";

export type ComposerChip =
  | { id: string; kind: "element"; citation: ElementCitation }
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "url"; url: string };

export type ComposerImage = {
  id: string;
  data: string;
  mimeType: string;
  /** data: URL or blob: URL for preview */
  previewUrl: string;
};

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

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Truncate element text for tag display (user asked for 100 chars). */
export function truncateElementContent(text: string, max = 100): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const trimmed = dataUrl.trim().replace(/\s+/g, "");
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(trimmed);
  if (!match?.[1] || !match[2]) return null;
  return { mimeType: match[1], data: match[2] };
}

export const useComposerStore = defineStore("composer", () => {
  const draft = ref("");
  const chips = ref<ComposerChip[]>([]);
  const images = ref<ComposerImage[]>([]);

  function elementCitations(): ElementCitation[] {
    return chips.value
      .filter((c): c is Extract<ComposerChip, { kind: "element" }> => c.kind === "element")
      .map((c) => c.citation);
  }

  function addImageFromDataUrl(dataUrl: string): void {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      console.warn("[composer] failed to parse image data URL");
      return;
    }
    // Deduplicate identical screenshots
    if (images.value.some((i) => i.data === parsed.data)) return;
    images.value = [
      ...images.value,
      {
        id: chipId(),
        data: parsed.data,
        mimeType: parsed.mimeType,
        previewUrl: `data:${parsed.mimeType};base64,${parsed.data}`,
      },
    ];
  }

  function addImageFile(image: Omit<ComposerImage, "id"> & { id?: string }): void {
    images.value = [
      ...images.value,
      {
        id: image.id ?? chipId(),
        data: image.data,
        mimeType: image.mimeType,
        previewUrl: image.previewUrl,
      },
    ];
  }

  function removeImage(id: string): void {
    const idx = images.value.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const next = [...images.value];
    const [img] = next.splice(idx, 1);
    if (img?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
    images.value = next;
  }

  function clearImages(): void {
    for (const img of images.value) {
      if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
    }
    images.value = [];
  }

  /**
   * Element tag (content only in UI). Screenshot arrives via separate IPC → addImageFromDataUrl.
   */
  function addCitation(citation: ElementCitation): void {
    chips.value = [
      ...chips.value,
      {
        id: chipId(),
        kind: "element",
        citation: {
          ...citation,
          htmlSnippet: truncateHtmlSnippet(citation.htmlSnippet),
          bounds: citation.bounds,
          screenshotDataUrl: citation.screenshotDataUrl,
        },
      },
    ];
    if (citation.screenshotDataUrl?.startsWith("data:")) {
      addImageFromDataUrl(citation.screenshotDataUrl);
    }
  }

  function attachScreenshotToLatestElement(dataUrl: string): void {
    for (let i = chips.value.length - 1; i >= 0; i--) {
      const chip = chips.value[i];
      if (chip?.kind === "element" && !chip.citation.screenshotDataUrl) {
        chips.value = chips.value.map((c, idx) =>
          idx === i && c.kind === "element"
            ? { ...c, citation: { ...c.citation, screenshotDataUrl: dataUrl } }
            : c,
        );
        return;
      }
    }
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
    const chip = chips.value.find((c) => c.id === id);
    if (chip?.kind === "element" && chip.citation.screenshotDataUrl) {
      const parsed = parseDataUrl(chip.citation.screenshotDataUrl);
      if (parsed) {
        const img = images.value.find((i) => i.data === parsed.data);
        if (img) removeImage(img.id);
      }
    }
    chips.value = chips.value.filter((c) => c.id !== id);
  }

  function clear(): void {
    draft.value = "";
    chips.value = [];
    clearImages();
  }

  /** Legacy name — now adds a file tag chip instead of plain text. */
  function insertPathRef(filePath: string): void {
    addFileTag(filePath);
  }

  /** Short @-style tags for the user-visible message (not the agent citation dump). */
  function formatChipsForMessage(): string {
    const parts: string[] = [];
    for (const chip of chips.value) {
      if (chip.kind === "file") {
        const ref = chip.path.includes(" ") ? `"${chip.path}"` : chip.path;
        parts.push(`@${ref}`);
      } else if (chip.kind === "url") {
        parts.push(chip.url);
      } else if (chip.kind === "element") {
        const content = truncateElementContent(chip.citation.text ?? "", 100);
        if (content) parts.push(content);
      }
    }
    return parts.join(" ");
  }

  /** Snapshot of element tags for chat bubble — content only. */
  function elementTagSnapshot(): {
    url: string;
    host: string;
    label: string;
    content: string;
  }[] {
    return elementCitations().map((c) => {
      const content = truncateElementContent(c.text ?? "", 100);
      return {
        url: c.url,
        host: hostFromUrl(c.url),
        label: content || c.selector?.trim() || "element",
        content,
      };
    });
  }

  return {
    draft,
    chips,
    images,
    elementCitations,
    elementTagSnapshot,
    addCitation,
    attachScreenshotToLatestElement,
    addImageFile,
    addImageFromDataUrl,
    removeImage,
    clearImages,
    addFileTag,
    addUrlTag,
    removeChip,
    clear,
    insertPathRef,
    formatChipsForMessage,
  };
});
