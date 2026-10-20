import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SlashItem } from "../../../shared/slash-commands";
import styles from "./ComposerSlashMenu.module.css";

export type ComposerSlashMenuHandle = {
  move: (delta: number) => void;
  confirm: () => boolean;
  readonly activeIndex: number;
};

export type ComposerSlashMenuProps = {
  items: SlashItem[];
  visible: boolean;
  onSelect?: (item: SlashItem) => void;
};

export const ComposerSlashMenu = forwardRef<
  ComposerSlashMenuHandle,
  ComposerSlashMenuProps
>(function ComposerSlashMenu(
  { items, visible, onSelect },
  ref,
): ReactNode {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const safeIndex = items.length ? Math.min(activeIndex, items.length - 1) : 0;
  const itemsKey = items.map((i) => i.id).join("|");

  useEffect(() => {
    setActiveIndex(0);
  }, [visible, itemsKey]);

  const scrollActiveIntoView = useCallback((): void => {
    const root = listRef.current;
    if (!root) return;
    const row = root.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  useEffect(() => {
    if (!visible) return;
    scrollActiveIntoView();
  }, [safeIndex, visible, scrollActiveIntoView]);

  const move = useCallback(
    (delta: number): void => {
      if (!items.length) return;
      setActiveIndex((prev) => {
        const current = items.length ? Math.min(prev, items.length - 1) : 0;
        const n = items.length;
        return (current + delta + n) % n;
      });
    },
    [items.length],
  );

  const confirm = useCallback((): boolean => {
    const item = items[safeIndex];
    if (!item) return false;
    onSelect?.(item);
    return true;
  }, [items, onSelect, safeIndex]);

  useImperativeHandle(
    ref,
    () => ({
      move,
      confirm,
      get activeIndex() {
        return safeIndex;
      },
    }),
    [confirm, move, safeIndex],
  );

  if (!visible || !items.length) return null;

  return (
    <div ref={listRef} className={styles.root} role="listbox">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.row} ${index === safeIndex ? styles.active : ""} ${
            item.kind === "skill" ? styles.skill : ""
          }`}
          role="option"
          data-index={index}
          aria-selected={index === safeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect?.(item);
          }}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <span className={styles.cmd}>/{item.command}</span>
          <span className={styles.desc}>{item.description}</span>
          <span className={styles.kind}>{item.kind === "skill" ? "skill" : "cmd"}</span>
        </button>
      ))}
    </div>
  );
});

export default ComposerSlashMenu;
