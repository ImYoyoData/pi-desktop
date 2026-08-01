import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import type { ElementCitation } from "../../../shared/protocol";
import { isRegionCitation } from "../../../shared/protocol";
import { truncateHtmlSnippet } from "../../../shared/html-snippet";
import type { ComposerAgentMode } from "../../../shared/composer-modes";
import { t } from "@renderer/i18n";
import { fileTagLabel, urlTagLabel } from "@renderer/utils/path-label";

export type ComposerChip =
  | { id: string; kind: "element"; citation: ElementCitation }
  | { id: string; kind: "file"; path: string; startLine?: number; endLine?: number }
  | { id: string; kind: "url"; url: string };

export type ComposerImage = {
  id: string;
  data: string;
  mimeType: string;
  /** data: URL or blob: URL for preview */
  previewUrl: string;
  /**
   * Absolute path of the copy cached in the session's attachment folder.
   * Hidden from the editor UI but passed to the model so it can locate the
   * image file (bound to the image, not shown as a chip).
   */
  cachePath?: string;
};

type ComposerBucket = {
  draft: string;
  chips: ComposerChip[];
  images: ComposerImage[];
  /** Persistent toolbar mode (not an editor capsule). */
  mode: ComposerAgentMode;
};

const NONE_KEY = "__none__";

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

function emptyBucket(): ComposerBucket {
  return { draft: "", chips: [], images: [], mode: "agent" };
}

export const useComposerStore = defineStore("composer", () => {
  /** Per-session composer state (draft / chips / images). */
  const bySession = reactive<Record<string, ComposerBucket>>({});
  const activeSessionId = ref<string | null>(null);

  function keyFor(sessionId: string | null | undefined): string {
    return sessionId?.trim() ? sessionId : NONE_KEY;
  }

  function ensureBucket(sessionId: string | null | undefined): ComposerBucket {
    const key = keyFor(sessionId);
    if (!bySession[key]) bySession[key] = emptyBucket();
    return bySession[key]!;
  }

  function bucket(): ComposerBucket {
    return ensureBucket(activeSessionId.value);
  }

  /** Bind UI to a session's private editor buffer. */
  function bindSession(sessionId: string | null): void {
    activeSessionId.value = sessionId;
    ensureBucket(sessionId);
  }

  function dropSession(sessionId: string): void {
    const key = keyFor(sessionId);
    const b = bySession[key];
    if (b) {
      for (const img of b.images) {
        if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
      }
      delete bySession[key];
    }
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null;
      ensureBucket(null);
    }
  }

  /** Clear all session buffers (e.g. workspace switch). */
  function resetAll(): void {
    for (const key of Object.keys(bySession)) {
      const b = bySession[key];
      if (!b) continue;
      for (const img of b.images) {
        if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
      }
      delete bySession[key];
    }
    activeSessionId.value = null;
    ensureBucket(null);
  }

  const draft = computed({
    get: () => bucket().draft,
    set: (v: string) => {
      bucket().draft = v;
    },
  });

  const chips = computed(() => bucket().chips);
  const images = computed(() => bucket().images);
  const mode = computed({
    get: () => bucket().mode,
    set: (value: ComposerAgentMode) => {
      bucket().mode = value;
    },
  });

  function setMode(next: ComposerAgentMode): void {
    bucket().mode = next;
  }

  function activeMode(): ComposerAgentMode {
    return bucket().mode;
  }

  function elementCitations(): ElementCitation[] {
    return bucket()
      .chips.filter((c): c is Extract<ComposerChip, { kind: "element" }> => c.kind === "element")
      .map((c) => c.citation);
  }

  function addImageFromDataUrl(dataUrl: string, cachePath?: string): boolean {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      console.warn("[composer] failed to parse image data URL");
      return false;
    }
    const b = bucket();
    if (b.images.some((i) => i.data === parsed.data)) return false;
    b.images = [
      ...b.images,
      {
        id: chipId(),
        data: parsed.data,
        mimeType: parsed.mimeType,
        previewUrl: `data:${parsed.mimeType};base64,${parsed.data}`,
        ...(cachePath ? { cachePath } : {}),
      },
    ];
    return true;
  }

  /**
   * Attach a pasted/dropped image: add it to the composer AND persist it into
   * the session's attachment cache, adding a file chip with its on-disk path
   * so the chat message carries the image address (text-only models can then
   * locate the file).
   */
  async function addPastedImage(dataUrl: string): Promise<void> {
    const sessionId = activeSessionId.value;
    if (!sessionId) return;
    try {
      const cached = await window.api.sessions.cacheImage(sessionId, { dataUrl });
      // The cached file path stays bound to the image (hidden in the editor,
      // included in the prompt) instead of a visible chip.
      addImageFromDataUrl(dataUrl, cached.filePath);
    } catch (err) {
      console.warn("[composer] cache pasted image failed", err);
      addImageFromDataUrl(dataUrl);
    }
  }

  /**
   * Download a remote image URL into the session cache and attach it as an
   * image (plus its cached file path chip). Returns false when the download
   * fails / the URL is not an image so callers can fall back to a URL tag.
   */
  async function addImageFromUrl(url: string): Promise<boolean> {
    const sessionId = activeSessionId.value;
    if (!sessionId) return false;
    try {
      const cached = await window.api.sessions.cacheImage(sessionId, { url });
      addImageFromDataUrl(cached.dataUrl, cached.filePath);
      return true;
    } catch (err) {
      console.warn("[composer] download image failed", err);
      return false;
    }
  }

  function addImageFile(image: Omit<ComposerImage, "id"> & { id?: string }): void {
    const b = bucket();
    b.images = [
      ...b.images,
      {
        id: image.id ?? chipId(),
        data: image.data,
        mimeType: image.mimeType,
        previewUrl: image.previewUrl,
      },
    ];
  }

  function removeImage(id: string): void {
    const b = bucket();
    const idx = b.images.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const next = [...b.images];
    const [img] = next.splice(idx, 1);
    if (img?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
    b.images = next;
    // Manual removal from the editor deletes the cached copy too — the
    // message is gone, so the attachment file is no longer referenced.
    if (img?.cachePath) {
      const sessionId = activeSessionId.value;
      if (sessionId) {
        void window.api.sessions.deleteCachedImage(sessionId, img.cachePath).catch(() => {
          // best-effort cleanup
        });
      }
    }
  }

  function clearImages(): void {
    const b = bucket();
    for (const img of b.images) {
      if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
    }
    b.images = [];
  }

  /**
   * Element tag (content only in UI). Screenshot arrives via separate IPC → addImageFromDataUrl.
   */
  function addCitation(citation: ElementCitation): void {
    const b = bucket();
    b.chips = [
      ...b.chips,
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
    const b = bucket();
    for (let i = b.chips.length - 1; i >= 0; i--) {
      const chip = b.chips[i];
      if (chip?.kind === "element" && !chip.citation.screenshotDataUrl) {
        b.chips = b.chips.map((c, idx) =>
          idx === i && c.kind === "element"
            ? { ...c, citation: { ...c.citation, screenshotDataUrl: dataUrl } }
            : c,
        );
        return;
      }
    }
  }

  function addFileTag(filePath: string, startLine?: number, endLine?: number): void {
    const path = filePath.trim();
    if (!path) return;
    const b = bucket();
    // Deduplicate: same path + same range → skip
    if (
      b.chips.some(
        (c) =>
          c.kind === "file" &&
          c.path === path &&
          c.startLine === startLine &&
          c.endLine === endLine,
      )
    )
      return;
    b.chips = [...b.chips, { id: chipId(), kind: "file", path, startLine, endLine }];
  }

  function addUrlTag(url: string): void {
    const normalized = url.trim();
    if (!isHttpUrl(normalized)) return;
    const b = bucket();
    if (b.chips.some((c) => c.kind === "url" && c.url === normalized)) return;
    b.chips = [...b.chips, { id: chipId(), kind: "url", url: normalized }];
  }

  function removeChip(id: string): void {
    const b = bucket();
    const chip = b.chips.find((c) => c.id === id);
    if (chip?.kind === "element" && chip.citation.screenshotDataUrl) {
      const parsed = parseDataUrl(chip.citation.screenshotDataUrl);
      if (parsed) {
        const img = b.images.find((i) => i.data === parsed.data);
        if (img) removeImage(img.id);
      }
    }
    b.chips = b.chips.filter((c) => c.id !== id);
  }

  function clear(): void {
    const b = bucket();
    b.draft = "";
    b.chips = [];
    clearImages();
  }

  /** Legacy name — now adds a file tag chip instead of plain text. */
  function insertPathRef(filePath: string): void {
    addFileTag(filePath);
  }

  /** Short @-style tags for the user-visible message (not the agent citation dump). */
  function formatChipsForMessage(): string {
    const parts: string[] = [];
    for (const chip of bucket().chips) {
      if (chip.kind === "file") {
        const ref = chip.path.includes(" ") ? `"${chip.path}"` : chip.path;
        const range =
          chip.startLine && chip.endLine
            ? `:${chip.startLine}-${chip.endLine}`
            : chip.startLine
              ? `:${chip.startLine}`
              : "";
        parts.push(`@${ref}${range}`);
      } else if (chip.kind === "url") {
        parts.push(chip.url);
      } else if (chip.kind === "element") {
        const content = truncateElementContent(chip.citation.text ?? "", 100);
        if (content) parts.push(content);
      }
    }
    return parts.join(" ");
  }

  /** Snapshot of attachment chips for chat bubble tags (file / url / element). */
  function attachmentTagSnapshot(): {
    kind: "file" | "url" | "element";
    label: string;
    title: string;
    ref: string;
    content?: string;
  }[] {
    const out: {
      kind: "file" | "url" | "element";
      label: string;
      title: string;
      ref: string;
      content?: string;
    }[] = [];
    for (const chip of bucket().chips) {
      if (chip.kind === "file") {
        const range =
          chip.startLine && chip.endLine
            ? `:${chip.startLine}-${chip.endLine}`
            : chip.startLine
              ? `:${chip.startLine}`
              : "";
        out.push({
          kind: "file",
          label: `${fileTagLabel(chip.path)}${range}`,
          title: chip.path,
          ref: chip.path,
          content: chip.path,
        });
      } else if (chip.kind === "url") {
        out.push({
          kind: "url",
          label: urlTagLabel(chip.url),
          title: chip.url,
          ref: chip.url,
          content: chip.url,
        });
      } else {
        const region = isRegionCitation(chip.citation);
        const content = truncateElementContent(chip.citation.text ?? "", 100);
        out.push({
          kind: "element",
          label: region ? t.chipRegion : content || chip.citation.selector?.trim() || "element",
          title: chip.citation.url,
          ref: chip.citation.url,
          content,
        });
      }
    }
    return out;
  }

  /** @deprecated use attachmentTagSnapshot — kept for element-only callers. */
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
    activeSessionId,
    draft,
    chips,
    images,
    mode,
    bindSession,
    dropSession,
    resetAll,
    elementCitations,
    elementTagSnapshot,
    attachmentTagSnapshot,
    addCitation,
    attachScreenshotToLatestElement,
    addImageFile,
    addImageFromDataUrl,
    addPastedImage,
    addImageFromUrl,
    removeImage,
    clearImages,
    addFileTag,
    addUrlTag,
    setMode,
    activeMode,
    removeChip,
    clear,
    insertPathRef,
    formatChipsForMessage,
  };
});
