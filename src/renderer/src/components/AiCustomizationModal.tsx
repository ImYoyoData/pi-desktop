import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import CodiconIcon from "@renderer/components/icons/CodiconIcon";
import AiCustomizationPage from "@renderer/components/AiCustomizationPage";
import { useLayoutStore } from "@renderer/stores/layout";
import { hasOpenModal } from "@renderer/utils/modal-overlay";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./AiCustomizationModal.module.css";

/**
 * VS Code modal editor 形态：居中浮层 + 40px 独立标题栏 + 半透明遮罩。
 * 尺寸取自 modalEditorPart.ts：默认 80%（上限 1400×900），最小 400×300。
 */
const TITLE_BAR_HEIGHT = 36;
const MAX_WIDTH = 1400;
const MAX_HEIGHT = 900;
const EDGE_PADDING = 8;

type Frame = {
  width: number;
  height: number;
  left: number;
  top: number;
};

function computeFrame(maximized: boolean): Frame {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const availableHeight = viewportHeight - TITLE_BAR_HEIGHT;
  if (maximized) {
    return {
      width: viewportWidth - EDGE_PADDING * 2,
      height: availableHeight - EDGE_PADDING * 2,
      left: EDGE_PADDING,
      top: TITLE_BAR_HEIGHT + EDGE_PADDING,
    };
  }
  const width = Math.min(viewportWidth * 0.8, MAX_WIDTH);
  const height = Math.min(availableHeight * 0.8, MAX_HEIGHT);
  return {
    width,
    height,
    left: (viewportWidth - width) / 2,
    top: TITLE_BAR_HEIGHT + (availableHeight - height) / 2,
  };
}

function hasOverlayModal(): boolean {
  return hasOpenModal() || document.querySelector(".ant-modal-mask") !== null;
}

export function AiCustomizationModal(): ReactNode {
  const t = useI18n();
  const layout = useLayoutStore();
  const [maximized, setMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [frame, setFrame] = useState<Frame>({ width: 0, height: 0, left: 0, top: 0 });
  const maximizedRef = useRef(maximized);
  maximizedRef.current = maximized;

  const close = useCallback((): void => {
    useLayoutStore.getState().showChat();
  }, []);

  const toggleMaximized = useCallback((): void => {
    setMaximized((current) => {
      const next = !current;
      setFrame(computeFrame(next));
      return next;
    });
  }, []);

  useEffect(() => {
    function onResize(): void {
      setFrame(computeFrame(maximizedRef.current));
    }

    /** Esc 关闭；页面内打开的模态优先消费 Esc。 */
    function onWindowKeydown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (hasOverlayModal()) return;
      close();
    }

    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onWindowKeydown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onWindowKeydown);
    };
  }, [close]);

  useEffect(() => {
    if (layout.centerView !== "customize") return;
    setMaximized(false);
    setFrame(computeFrame(false));
  }, [layout.centerView]);

  function onHeaderPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if ((event.target as HTMLElement).closest("button") || maximized) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = frame.left;
    const startTop = frame.top;
    setDragging(true);
    const onMove = (move: PointerEvent): void => {
      setFrame((current) => ({
        ...current,
        left: Math.min(
          Math.max(startLeft + move.clientX - startX, EDGE_PADDING),
          window.innerWidth - current.width - EDGE_PADDING,
        ),
        top: Math.min(
          Math.max(startTop + move.clientY - startY, TITLE_BAR_HEIGHT + EDGE_PADDING),
          window.innerHeight - current.height - EDGE_PADDING,
        ),
      }));
    };
    const onUp = (): void => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (layout.centerView !== "customize") return null;

  return createPortal(
    <div className={styles.modalEditorBlock}>
      <div
        className={`modal-editor-panel ${styles.modalEditorPanel}`}
        style={{
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          left: `${frame.left}px`,
          top: `${frame.top}px`,
        }}
      >
        <header
          className={dragging ? `${styles.modalEditorHeader} ${styles.dragging}` : styles.modalEditorHeader}
          onPointerDown={onHeaderPointerDown}
          onDoubleClick={toggleMaximized}
        >
          <div className={styles.modalEditorTitle}>{t.customizeTitle}</div>
          <div className={styles.modalEditorActions}>
            <button
              type="button"
              className={styles.modalEditorIconButton}
              title={maximized ? t.customizeRestore : t.customizeMaximize}
              aria-label={maximized ? t.customizeRestore : t.customizeMaximize}
              onClick={toggleMaximized}
            >
              <CodiconIcon name={maximized ? "restore" : "maximize"} size={14} />
            </button>
            <span className={styles.modalEditorActionSeparator} aria-hidden="true" />
            <button
              type="button"
              className={styles.modalEditorIconButton}
              title={t.close}
              aria-label={t.close}
              onClick={close}
            >
              <CodiconIcon name="close" size={14} />
            </button>
          </div>
        </header>
        <div className={styles.modalEditorContent}>
          <AiCustomizationPage section={layout.customizeSection} visible />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default AiCustomizationModal;
