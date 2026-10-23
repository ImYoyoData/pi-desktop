import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { atFileDirLabel, type AtFileItem } from "../../../shared/at-file-mention";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ComposerAtFileMenu.module.css";

export type ComposerAtFileMenuHandle = {
  move: (delta: number) => void;
  confirm: () => boolean;
  readonly activeIndex: number;
};

export type ComposerAtFileMenuProps = {
  items: AtFileItem[];
  visible: boolean;
  emptyHint?: string;
  onSelect?: (item: AtFileItem) => void;
};

export const ComposerAtFileMenu = forwardRef<
  ComposerAtFileMenuHandle,
  ComposerAtFileMenuProps
>(function ComposerAtFileMenu(
  { items, visible, emptyHint, onSelect },
  ref,
): ReactNode {
  const t = useI18n();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const safeIndex = items.length ? Math.min(activeIndex, items.length - 1) : 0;
  const itemsKey = items.map((i) => i.path).join("|");

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

  if (!visible) return null;

  return (
    <div
      ref={listRef}
      className={`composer-at-file-menu ${styles.root}`}
      role="listbox"
      aria-label={t.atFileMenuLabel}
    >
      {!items.length ? (
        <div className={styles.empty}>{emptyHint || t.atFileEmpty}</div>
      ) : null}
      {items.map((item, index) => (
        <button
          key={item.path}
          type="button"
          className={`${styles.row} ${index === safeIndex ? styles.active : ""}`}
          role="option"
          data-index={index}
          aria-selected={index === safeIndex}
          title={item.path}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect?.(item);
          }}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <span
            className={`${styles.icon} ${
              item.kind === "dir" ? styles.iconDir : styles.iconFile
            }`}
            aria-hidden="true"
          />
          <span className={styles.name}>{item.name}</span>
          <span className={styles.dir}>{atFileDirLabel(item.path)}</span>
        </button>
      ))}
    </div>
  );
});

export default ComposerAtFileMenu;
