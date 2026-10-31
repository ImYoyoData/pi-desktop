import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import styles from "./PageSplit.module.css";

type Props = {
  /** 侧栏宽度（像素）。 */
  width: number;
  onWidthChange: (width: number) => void;
  minWidth: number;
  maxWidth: number;
  /** 侧栏位置，默认在左。 */
  sidePosition?: "start" | "end";
  /** 隐藏侧栏，只保留主区。 */
  sideHidden?: boolean;
  side: ReactNode;
  children: ReactNode;
};

/** 右侧栏内的“列表 + 内容”分栏，宽度可拖动。 */
export function PageSplit({
  width,
  onWidthChange,
  minWidth,
  maxWidth,
  sidePosition = "start",
  sideHidden = false,
  side,
  children,
}: Props): ReactNode {
  const sideRef = useRef<HTMLDivElement | null>(null);

  /** 拖动期间直接改样式，松手才回写状态，避免整页每帧重渲染。 */
  function onDividerDown(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let next = startWidth;
    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientX - startX;
      next = Math.min(
        maxWidth,
        Math.max(minWidth, startWidth + (sidePosition === "end" ? -delta : delta)),
      );
      if (sideRef.current) sideRef.current.style.width = `${next}px`;
    };
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (next !== startWidth) onWidthChange(next);
      else if (sideRef.current) sideRef.current.style.width = `${startWidth}px`;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className={sidePosition === "end" ? `${styles.root} ${styles.rootEnd}` : styles.root}>
      {sideHidden ? null : (
        <>
          <div ref={sideRef} className={styles.side} style={{ width: `${width}px` }}>
            {side}
          </div>
          <div className={styles.divider} aria-hidden="true" onMouseDown={onDividerDown} />
        </>
      )}
      <div className={styles.main}>{children}</div>
    </div>
  );
}

export default PageSplit;
