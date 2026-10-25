import {
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { FolderOutline } from "@renderer/components/icons/ionicons";
import { fileIcon } from "@renderer/utils/file-icon";
import styles from "./FileChip.module.css";

type Props = {
  path: string;
  /** Override the visible label (defaults to the basename). */
  label?: string;
  /**
   * 目录：Seti 只有文件图标，目录改用 ionicon 的文件夹。
   * 目录也没有可预览的内容，因此渲染成不可点的静态 chip。
   */
  dir?: boolean;
  onOpen?: (path: string) => void;
};

export function FileChip({ path, label, dir, onOpen }: Props): ReactNode {
  const fileName = useMemo(() => {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }, [path]);

  const glyph = useMemo(() => (dir ? null : fileIcon(path)), [dir, path]);

  function onClick(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    onOpen?.(path);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Enter") return;
    event.stopPropagation();
    onOpen?.(path);
  }

  const icon = dir ? (
    <FolderOutline size={13} className={styles.dirGlyph} aria-hidden="true" />
  ) : (
    <span
      className={styles.glyph}
      style={glyph?.color ? { color: glyph.color } : undefined}
      aria-hidden="true"
    >
      {glyph?.glyph}
    </span>
  );

  const text = <span className={styles.label}>{label ?? fileName}</span>;

  if (dir || !onOpen) {
    return (
      <span className={`file-chip ${styles.root} ${styles.static}`} title={path}>
        {icon}
        {text}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`file-chip ${styles.root}`}
      title={path}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {icon}
      {text}
    </button>
  );
}

export default FileChip;
