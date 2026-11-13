import {
  useEffect,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
} from "react";
import type { ComposerRichEditorHandle } from "@renderer/components/ComposerRichEditor";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import { isHttpUrl, useComposerStore } from "@renderer/stores/composer";
import {
  coercePathToken,
  toWorkspaceRelative,
  transferTypesHaveFilePayload,
  type WorkspacePathContext,
} from "@renderer/utils/composer-paths";
import { plainTextFromClipboard } from "@renderer/utils/composer-rich";
import {
  decodeWorkspacePaths,
  PI_WORKSPACE_PATHS_MIME,
} from "@renderer/utils/workspace-path-dnd";
import { useLatest } from "./use-latest";

type Params = {
  root: string;
  richEditorRef: MutableRefObject<ComposerRichEditorHandle | null>;
};

/**
 * Composer 的附件入口：拖拽、粘贴、文件选择。
 *
 * 所有入口最终都归一到 composer store 的 file tag / image；
 * URL 文本只在拖拽时按落点插入，粘贴保持普通文本语义。
 */
export function useComposerAttachments({ root, richEditorRef }: Params) {
  const t = useI18n();
  const messageApi = useMessage();

  const fileDragOver = useLatest(false);
  const pathCaseInsensitive = useLatest(false);

  /** Prefer workspace-relative paths for file tags. */
  const pathCtx: WorkspacePathContext = {
    root: root || "",
    caseInsensitive: pathCaseInsensitive.value,
  };

  function toWorkspaceRelativePath(p: string): string {
    return toWorkspaceRelative(p, pathCtx);
  }

  /** Absolute / file:// / workspace-relative path token → workspace-relative for file tags. */
  function coercePathTokenInComposer(raw: string): string | null {
    return coercePathToken(raw, pathCtx);
  }

  function electronFilePath(file: File): string | null {
    let p = (file as File & { path?: string }).path;
    if (typeof p !== "string" || !p.trim()) {
      try {
        p = window.api.files.getPathForFile(file);
      } catch {
        p = "";
      }
    }
    if (typeof p === "string" && p.trim()) return toWorkspaceRelativePath(p.trim());
    return null;
  }

  async function readImageFile(file: File): Promise<{
    data: string;
    mimeType: string;
    previewUrl: string;
  } | null> {
    if (!file.type.startsWith("image/")) return null;
    if (file.size > 8 * 1024 * 1024) {
      messageApi.warning(t.imageTooLarge);
      return null;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    return {
      data: base64,
      mimeType: file.type || "image/png",
      previewUrl: URL.createObjectURL(file),
    };
  }

  async function addFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    for (const file of list) {
      if (file.type.startsWith("image/")) {
        try {
          const img = await readImageFile(file);
          if (img) {
            // Persist into the session cache so the message references a real file.
            await useComposerStore
              .getState()
              .addPastedImage(`data:${img.mimeType};base64,${img.data}`);
            if (img.previewUrl.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
          }
        } catch (err) {
          console.warn("[composer] failed to read pasted image", err);
        }
        continue;
      }
      const filePath = electronFilePath(file);
      if (filePath) useComposerStore.getState().addFileTag(filePath);
    }
  }

  /**
   * Shared drop ingest. Returns what the caller should do with the event:
   * - { kind: "files" }: paths/images already became tags & attachments — consume it.
   * - { kind: "text" }: payload is an http(s) URL — insert as plain text (never a chip).
   * - null: nothing to handle — leave the browser's default behavior.
   */
  function ingestTransferData(
    data: DataTransfer,
  ): { kind: "files" } | { kind: "text"; text: string } | null {
    const custom = data.getData(PI_WORKSPACE_PATHS_MIME)?.trim() ?? "";
    if (custom) {
      const paths = decodeWorkspacePaths(custom);
      if (paths.length) {
        for (const filePath of paths) {
          useComposerStore.getState().addFileTag(filePath);
        }
        return { kind: "files" };
      }
    }

    const imageFiles: File[] = [];
    const pathFiles: File[] = [];

    if (data.files?.length) {
      for (const file of Array.from(data.files)) {
        if (file.type.startsWith("image/")) imageFiles.push(file);
        else pathFiles.push(file);
      }
    }

    if (data.items) {
      for (const item of Array.from(data.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        if (file.type.startsWith("image/") || item.type.startsWith("image/")) {
          if (!imageFiles.some((f) => f.name === file.name && f.size === file.size)) {
            imageFiles.push(file);
          }
        } else if (!pathFiles.some((f) => f.name === file.name && f.size === file.size)) {
          pathFiles.push(file);
        }
      }
    }

    if (imageFiles.length || pathFiles.length) {
      if (imageFiles.length) void addFiles(imageFiles);
      for (const file of pathFiles) {
        const filePath = electronFilePath(file);
        if (filePath) useComposerStore.getState().addFileTag(filePath);
      }
      return { kind: "files" };
    }

    const uriList = data.getData("text/uri-list")?.trim() ?? "";
    if (uriList) {
      const filePaths: string[] = [];
      const urls: string[] = [];
      for (const line of uriList.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        if (/^https?:\/\//i.test(trimmed)) {
          urls.push(trimmed);
          continue;
        }
        const filePath = coercePathTokenInComposer(trimmed);
        if (filePath) filePaths.push(filePath);
      }
      for (const filePath of filePaths) {
        useComposerStore.getState().addFileTag(filePath);
      }
      if (urls.length) return { kind: "text", text: urls.join("\n") };
      if (filePaths.length) return { kind: "files" };
    }

    const text = data.getData("text/plain")?.trim() ?? "";
    if (text && isHttpUrl(text)) {
      return { kind: "text", text };
    }

    if (text) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const asPaths = lines
        .map(coercePathTokenInComposer)
        .filter((p): p is string => Boolean(p));
      if (asPaths.length && asPaths.length === lines.length) {
        for (const filePath of asPaths) {
          useComposerStore.getState().addFileTag(filePath);
        }
        return { kind: "files" };
      }
    }

    return null;
  }

  function transferHasFilePayload(data: DataTransfer): boolean {
    return transferTypesHaveFilePayload(data.types);
  }

  /** Park the caret at the drop point so URL drops insert exactly where released. */
  function placeDropCaret(clientX: number, clientY: number): void {
    const surface = richEditorRef.current?.getSurface() ?? null;
    if (!surface) return;
    surface.focus();
    const caretFromPoint = (
      document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      }
    ).caretRangeFromPoint;
    const range = caretFromPoint ? caretFromPoint.call(document, clientX, clientY) : null;
    if (!range || !surface.contains(range.startContainer)) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function onComposerDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    const data = event.dataTransfer;
    if (!data || !transferHasFilePayload(data)) return;
    event.preventDefault();
    data.dropEffect = "copy";
    fileDragOver.set(true);
  }

  function onComposerDragLeave(event: ReactDragEvent<HTMLDivElement>): void {
    const next = event.relatedTarget as Node | null;
    const card = event.currentTarget as HTMLElement | null;
    if (card && next && card.contains(next)) return;
    fileDragOver.set(false);
  }

  function onComposerDrop(event: ReactDragEvent<HTMLDivElement>): void {
    fileDragOver.set(false);
    const data = event.dataTransfer;
    if (!data) return;
    const outcome = ingestTransferData(data);
    if (!outcome) return;
    event.preventDefault();
    event.stopPropagation();
    if (outcome.kind === "text") {
      // Dropped http(s) URLs stay plain text — insert where the user let go.
      placeDropCaret(event.clientX, event.clientY);
      richEditorRef.current?.insertTextAtCaret(outcome.text, true);
    }
  }

  /** Extract the first http(s) <img src> from pasted HTML (web images). */
  function imgUrlFromHtml(html: string): string | null {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const img = doc.querySelector("img[src]");
    const src = img?.getAttribute("src")?.trim() ?? "";
    return src && isHttpUrl(src) ? src : null;
  }

  /**
   * Paste into the composer: only image bitmaps are attached. http(s) URLs,
   * file paths and any other text stay plain text — the path→tag behavior is
   * reserved for drag & drop (ingestTransferData), not paste. Rich HTML from
   * Word/browsers is always stripped to plain text so styles cannot leak into
   * the contenteditable surface.
   */
  function onPaste(event: ReactClipboardEvent<HTMLDivElement>): void {
    try {
      const data = event.clipboardData;
      if (!data) return;
      const imageFiles: File[] = [];
      if (data.files?.length) {
        for (const file of Array.from(data.files)) {
          if (file.type.startsWith("image/")) imageFiles.push(file);
        }
      }
      if (!imageFiles.length && data.items) {
        for (const item of Array.from(data.items)) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file && !imageFiles.some((f) => f.name === file.name && f.size === file.size)) {
              imageFiles.push(file);
            }
          }
        }
      }
      if (imageFiles.length) {
        event.preventDefault();
        void addFiles(imageFiles).catch((err) => {
          console.warn("[composer] paste image failed", err);
        });
        return;
      }

      // Copying an image from a web page often carries an <img> tag in the
      // HTML with no bitmap file — download it into the session cache instead
      // of leaving an unreadable URL.
      const html = data.getData("text/html") ?? "";
      const htmlImgUrl = html ? imgUrlFromHtml(html) : null;
      if (htmlImgUrl) {
        event.preventDefault();
        void useComposerStore.getState().addImageFromUrl(htmlImgUrl).then((ok) => {
          if (!ok) messageApi.warning(t.pasteImageDownloadFailed);
        });
        return;
      }

      // Strip Word/browser formatting: never let contenteditable insert styled HTML.
      const plain = plainTextFromClipboard(data.getData("text/plain") ?? "", html);
      // 空白同样是用户复制的内容（缩进、空格），逐字插入，不能因 trim 为空就丢弃。
      if (!plain) return;
      event.preventDefault();
      richEditorRef.current?.insertTextAtCaret(plain);
    } catch (err) {
      // Never let a paste handler exception swallow the user's clipboard.
      console.warn("[composer] onPaste error", err);
    }
  }

  useEffect(() => {
    void window.api.window.platform().then((p) => {
      // Windows + default macOS APFS volumes are case-insensitive.
      pathCaseInsensitive.set(p === "win32" || p === "darwin");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时读取平台，与原实现一致
  }, []);

  return {
    fileDragOver,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    onPaste,
    addFiles,
  };
}
