import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import styles from "./PageSplit.module.css";

type Props = {
  /** 侧栏宽度（像素）。 */
  width: number;
  onWidthChange: (width: number) => void;
  minWidth: number;
  maxWidth: number;
  side: ReactNode;
  children: ReactNode;
};

/** 右侧栏内的“列表 + 内容”分栏，宽度可拖动。 */
export function PageSplit({
  width,
  onWidthChange,
  minWidth,
  maxWidth,
  side,
  children,
}: Props): ReactNode {
  function onDividerDown(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: MouseEvent): void => {
      const next = startWidth + (moveEvent.clientX - startX);
      onWidthChange(Math.min(maxWidth, Math.max(minWidth, next)));
    };
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className={styles.root}>
      <div className={styles.side} style={{ width: `${width}px` }}>
        {side}
      </div>
      <div className={styles.divider} aria-hidden="true" onMouseDown={onDividerDown} />
      <div className={styles.main}>{children}</div>
    </div>
  );
}

export default PageSplit;
