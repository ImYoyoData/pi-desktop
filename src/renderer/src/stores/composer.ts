import { create } from "zustand";
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

const EMPTY_BUCKET: ComposerBucket = emptyBucket();

function keyFor(sessionId: string | null | undefined): string {
  return sessionId?.trim() ? sessionId : NONE_KEY;
}

type ComposerBase = {
  /** Per-session composer state (draft / chips / images). */
  bySession: Record<string, ComposerBucket>;
  activeSessionId: string | null;
};

type ComposerDerived = {
  draft: string;
  chips: ComposerChip[];
  images: ComposerImage[];
  mode: ComposerAgentMode;
};

function derive(base: ComposerBase): ComposerDerived {
  const bucket = base.bySession[keyFor(base.activeSessionId)] ?? EMPTY_BUCKET;
  return {
    draft: bucket.draft,
    chips: bucket.chips,
    images: bucket.images,
    mode: bucket.mode,
  };
}

export type ComposerState = ComposerBase &
  ComposerDerived & {
    bindSession: (sessionId: string | null) => void;
    dropSession: (sessionId: string) => void;
    resetAll: () => void;
    setDraft: (next: string) => void;
    setMode: (next: ComposerAgentMode) => void;
    activeMode: () => ComposerAgentMode;
    elementCitations: () => ElementCitation[];
    elementTagSnapshot: () => {
      url: string;
      host: string;
      label: string;
      content: string;
    }[];
    attachmentTagSnapshot: () => {
      kind: "file" | "url" | "element";
      label: string;
      title: string;
      ref: string;
      content?: string;
    }[];
    addCitation: (citation: ElementCitation) => void;
    attachScreenshotToLatestElement: (dataUrl: string) => void;
    addImageFile: (image: Omit<ComposerImage, "id"> & { id?: string }) => void;
    addImageFromDataUrl: (dataUrl: string, cachePath?: string) => boolean;
    addPastedImage: (dataUrl: string) => Promise<void>;
    addImageFromUrl: (url: string) => Promise<boolean>;
    removeImage: (id: string) => void;
    clearImages: () => void;
    addFileTag: (filePath: string, startLine?: number, endLine?: number) => void;
    addUrlTag: (url: string) => void;
    transferDraftMode: (toSessionId: string, mode: ComposerAgentMode) => void;
    removeChip: (id: string) => void;
    clear: () => void;
    clearSession: (sessionId: string | null) => void;
    insertPathRef: (filePath: string) => void;
    formatChipsForMessage: () => string;
  };

export const useComposerStore = create<ComposerState>()((set, get) => {
  function commit(patch: Partial<ComposerBase>): void {
    set((state) => {
      const next = { ...state, ...patch };
      return { ...next, ...derive(next) };
    });
  }

  function currentBucket(): ComposerBucket {
    const state = get();
    return state.bySession[keyFor(state.activeSessionId)] ?? EMPTY_BUCKET;
  }

  function updateBucketFor(
    sessionId: string | null | undefined,
    patch: (bucket: ComposerBucket) => ComposerBucket,
  ): void {
    const key = keyFor(sessionId);
    const current = get().bySession[key] ?? emptyBucket();
    commit({ bySession: { ...get().bySession, [key]: patch(current) } });
  }

  function updateActiveBucket(patch: (bucket: ComposerBucket) => ComposerBucket): void {
    updateBucketFor(get().activeSessionId, patch);
  }

  /** Bind UI to a session's private editor buffer. */
  function bindSession(sessionId: string | null): void {
    const key = keyFor(sessionId);
    const bySession = get().bySession;
    commit({
      bySession: bySession[key] ? bySession : { ...bySession, [key]: emptyBucket() },
      activeSessionId: sessionId,
    });
  }

  function dropSession(sessionId: string): void {
    const key = keyFor(sessionId);
    const bucket = get().bySession[key];
    if (bucket) {
      for (const img of bucket.images) {
        if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
      }
    }
    const bySession = { ...get().bySession };
    delete bySession[key];
    if (get().activeSessionId !== sessionId) {
      commit({ bySession });
      return;
    }
    bySession[NONE_KEY] = bySession[NONE_KEY] ?? emptyBucket();
    commit({ bySession, activeSessionId: null });
  }

  /** Clear all session buffers (e.g. workspace switch). */
  function resetAll(): void {
    for (const bucket of Object.values(get().bySession)) {
      for (const img of bucket.images) {
        if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
      }
    }
    commit({ bySession: { [NONE_KEY]: emptyBucket() }, activeSessionId: null });
  }

  function setDraft(next: string): void {
    updateActiveBucket((bucket) => ({ ...bucket, draft: next }));
  }

  function setMode(next: ComposerAgentMode): void {
    updateActiveBucket((bucket) => ({ ...bucket, mode: next }));
  }

  function activeMode(): ComposerAgentMode {
    return get().mode;
  }

  /** 草稿首次发送：把工具栏模式迁移到新会话，草稿桶恢复默认。 */
  function transferDraftMode(toSessionId: string, mode: ComposerAgentMode): void {
    const bySession = { ...get().bySession };
    bySession[NONE_KEY] = { ...(bySession[NONE_KEY] ?? emptyBucket()), mode: "agent" };
    bySession[toSessionId] = { ...(bySession[toSessionId] ?? emptyBucket()), mode };
    commit({ bySession });
  }

  function elementCitations(): ElementCitation[] {
    return currentBucket()
      .chips.filter((c): c is Extract<ComposerChip, { kind: "element" }> => c.kind === "element")
      .map((c) => c.citation);
  }

  function addImageFromDataUrl(dataUrl: string, cachePath?: string): boolean {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      console.warn("[composer] failed to parse image data URL");
      return false;
    }
    if (currentBucket().images.some((i) => i.data === parsed.data)) return false;
    updateActiveBucket((bucket) => ({
      ...bucket,
      images: [
        ...bucket.images,
        {
          id: chipId(),
          data: parsed.data,
          mimeType: parsed.mimeType,
          previewUrl: `data:${parsed.mimeType};base64,${parsed.data}`,
          ...(cachePath ? { cachePath } : {}),
        },
      ],
    }));
    return true;
  }

  /**
   * Attach a pasted/dropped image: add it to the composer AND persist it into
   * the session's attachment cache, adding a file chip with its on-disk path
   * so the chat message carries the image address (text-only models can then
   * locate the file).
   */
  async function addPastedImage(dataUrl: string): Promise<void> {
    const sessionId = get().activeSessionId;
    // 草稿（未创建会话）没有附件目录可缓存，先内联保存，发送时再随消息带走。
    if (!sessionId) {
      addImageFromDataUrl(dataUrl);
      return;
    }
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
    const sessionId = get().activeSessionId;
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
    updateActiveBucket((bucket) => ({
      ...bucket,
      images: [
        ...bucket.images,
        {
          id: image.id ?? chipId(),
          data: image.data,
          mimeType: image.mimeType,
          previewUrl: image.previewUrl,
        },
      ],
    }));
  }

  function removeImage(id: string): void {
    const bucket = currentBucket();
    const img = bucket.images.find((i) => i.id === id);
    if (!img) return;
    if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
    updateActiveBucket((b) => ({ ...b, images: b.images.filter((i) => i.id !== id) }));
    // Manual removal from the editor deletes the cached copy too — the
    // message is gone, so the attachment file is no longer referenced.
    if (img.cachePath) {
      const sessionId = get().activeSessionId;
      if (sessionId) {
        void window.api.sessions.deleteCachedImage(sessionId, img.cachePath).catch(() => {
          // best-effort cleanup
        });
      }
    }
  }

  function clearImages(): void {
    const bucket = currentBucket();
    for (const img of bucket.images) {
      if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
    }
    updateActiveBucket((b) => ({ ...b, images: [] }));
  }

  /**
   * Element tag (content only in UI). Screenshot arrives via separate IPC → addImageFromDataUrl.
   */
  function addCitation(citation: ElementCitation): void {
    updateActiveBucket((bucket) => ({
      ...bucket,
      chips: [
        ...bucket.chips,
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
      ],
    }));
    if (citation.screenshotDataUrl?.startsWith("data:")) {
      addImageFromDataUrl(citation.screenshotDataUrl);
    }
  }

  function attachScreenshotToLatestElement(dataUrl: string): void {
    updateActiveBucket((bucket) => {
      for (let i = bucket.chips.length - 1; i >= 0; i--) {
        const chip = bucket.chips[i];
        if (chip?.kind === "element" && !chip.citation.screenshotDataUrl) {
          return {
            ...bucket,
            chips: bucket.chips.map((c, idx) =>
              idx === i && c.kind === "element"
                ? { ...c, citation: { ...c.citation, screenshotDataUrl: dataUrl } }
                : c,
            ),
          };
        }
      }
      return bucket;
    });
  }

  function addFileTag(filePath: string, startLine?: number, endLine?: number): void {
    const path = filePath.trim();
    if (!path) return;
    updateActiveBucket((bucket) => {
      // Deduplicate: same path + same range → skip
      const duplicate = bucket.chips.some(
        (c) =>
          c.kind === "file" &&
          c.path === path &&
          c.startLine === startLine &&
          c.endLine === endLine,
      );
      if (duplicate) return bucket;
      return {
        ...bucket,
        chips: [...bucket.chips, { id: chipId(), kind: "file", path, startLine, endLine }],
      };
    });
  }

  function addUrlTag(url: string): void {
    const normalized = url.trim();
    if (!isHttpUrl(normalized)) return;
    updateActiveBucket((bucket) => {
      if (bucket.chips.some((c) => c.kind === "url" && c.url === normalized)) return bucket;
      return { ...bucket, chips: [...bucket.chips, { id: chipId(), kind: "url", url: normalized }] };
    });
  }

  function removeChip(id: string): void {
    const bucket = currentBucket();
    const chip = bucket.chips.find((c) => c.id === id);
    if (chip?.kind === "element" && chip.citation.screenshotDataUrl) {
      const parsed = parseDataUrl(chip.citation.screenshotDataUrl);
      if (parsed) {
        const img = bucket.images.find((i) => i.data === parsed.data);
        if (img) removeImage(img.id);
      }
    }
    updateActiveBucket((b) => ({ ...b, chips: b.chips.filter((c) => c.id !== id) }));
  }

  /** 清空指定会话（草稿传 null）的输入缓冲；与当前活动会话无关。 */
  function clearSession(sessionId: string | null): void {
    const key = keyFor(sessionId);
    const bucket = get().bySession[key];
    if (!bucket) return;
    for (const img of bucket.images) {
      if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
    }
    updateBucketFor(sessionId, (b) => ({ ...b, draft: "", chips: [], images: [] }));
  }

  function clear(): void {
    clearSession(get().activeSessionId);
  }

  /** Legacy name — now adds a file tag chip instead of plain text. */
  function insertPathRef(filePath: string): void {
    addFileTag(filePath);
  }

  /** Short @-style tags for the user-visible message (not the agent citation dump). */
  function formatChipsForMessage(): string {
    const parts: string[] = [];
    for (const chip of currentBucket().chips) {
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
    for (const chip of currentBucket().chips) {
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

  const base: ComposerBase = { bySession: {}, activeSessionId: null };

  return {
    ...base,
    ...derive(base),
    bindSession,
    dropSession,
    resetAll,
    setDraft,
    setMode,
    activeMode,
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
    transferDraftMode,
    removeChip,
    clear,
    clearSession,
    insertPathRef,
    formatChipsForMessage,
  };
});
