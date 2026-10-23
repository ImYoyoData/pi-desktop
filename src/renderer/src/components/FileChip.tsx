import {
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { fileIcon } from "@renderer/utils/file-icon";
import styles from "./FileChip.module.css";

type Props = {
  path: string;
  /** Override the visible label (defaults to the basename). */
  label?: string;
  onOpen?: (path: string) => void;
};

export function FileChip({ path, label, onOpen }: Props): ReactNode {
  const fileName = useMemo(() => {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }, [path]);

  const glyph = useMemo(() => fileIcon(path), [path]);

  function onClick(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onOpen?.(path);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Enter") return;
    event.stopPropagation();
    onOpen?.(path);
  }

  return (
    <button
      type="button"
      className={`file-chip ${styles.root}`}
      title={path}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span
        className={styles.glyph}
        style={glyph.color ? { color: glyph.color } : undefined}
        aria-hidden="true"
      >
        {glyph.glyph}
      </span>
      <span className={styles.label}>{label ?? fileName}</span>
    </button>
  );
}

export default FileChip;
