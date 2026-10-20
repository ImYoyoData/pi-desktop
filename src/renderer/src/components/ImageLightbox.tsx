import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ImageLightbox.module.css";

/**
 * 图片灯箱：点击放大，右键复制 / 保存。组件库的预览没有剪贴板集成，
 * 所以自己实现一份。
 */

type Props = {
  /** null 表示不显示。 */
  dataUrl: string | null;
  mimeType: string;
  onClose: () => void;
};

export function ImageLightbox({ dataUrl, mimeType, onClose }: Props): ReactNode {
  const t = useI18n();
  const messageApi = useMessage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    setMenuOpen(false);
    if (!dataUrl) return;
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
    };
  }, [dataUrl]);

  /** 右键菜单贴边收口，避免超出视口。 */
  function openMenu(event: MouseEvent<HTMLImageElement>): void {
    const menuW = 160;
    const menuH = 76;
    setMenuPos({
      x: Math.max(4, Math.min(event.clientX, window.innerWidth - menuW - 4)),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - menuH - 4)),
    });
    setMenuOpen(true);
  }

  async function copyImage(): Promise<void> {
    if (!dataUrl) return;
    try {
      await window.api.clipboard.writeImage(dataUrl);
      setMenuOpen(false);
      messageApi.success(t.copyImageDone);
    } catch (err) {
      setMenuOpen(false);
      messageApi.error(err instanceof Error ? err.message : String(err));
    }
  }

  function saveImage(): void {
    if (!dataUrl) return;
    setMenuOpen(false);
    const a = document.createElement("a");
    a.href = dataUrl;
    const ext = (mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "") || "png";
    a.download = `image-${Date.now()}.${ext}`;
    a.click();
  }

  function onOverlayKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") onClose();
  }

  return createPortal(
    dataUrl ? (
      <div
        className={styles.imagePreviewOverlay}
        tabIndex={-1}
        onKeyDown={onOverlayKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          onClose();
        }}
      >
        <div className={styles.previewToolbar}>
          <span className={styles.previewTitle}>{t.imageAttachment}</span>
          <div className={styles.previewActions}>
            <button type="button" className={styles.previewBtn} onClick={copyImage}>
              {t.copyImage}
            </button>
            <button type="button" className={styles.previewBtn} onClick={saveImage}>
              {t.saveImage}
            </button>
            <button
              type="button"
              className={`${styles.previewBtn} ${styles.close}`}
              aria-label={t.close}
              title={t.close}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>
        <img
          src={dataUrl}
          className={styles.previewImg}
          alt=""
          onContextMenu={(event) => {
            event.preventDefault();
            openMenu(event);
          }}
        />
        {menuOpen ? (
          <div
            className={`preview-context-menu ${styles.previewContextMenu}`}
            style={{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button type="button" className={styles.ctxItem} onClick={copyImage}>
              {t.copyImage}
            </button>
            <button type="button" className={styles.ctxItem} onClick={saveImage}>
              {t.saveImage}
            </button>
          </div>
        ) : null}
      </div>
    ) : null,
    document.body,
  );
}

export default ImageLightbox;
