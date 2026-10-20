import type { ReactNode } from "react";
import { ChevronDownOutline, ChevronForwardOutline } from "@renderer/components/icons/ionicons";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { TurnFileChanges } from "@renderer/utils/turn-file-changes";
import styles from "./TurnDiffSummary.module.css";

type Props = {
  changes: TurnFileChanges;
  open: boolean;
  onToggle: () => void;
  onOpenFile: (path: string) => void;
};

export function TurnDiffSummary({ changes, open, onToggle, onOpenFile }: Props): ReactNode {
  const t = useI18n();

  /** 目录与文件名分开渲染：目录从左侧省略，文件名始终可见。 */
  function splitPath(path: string): { dir: string; name: string } {
    const norm = path.replace(/\\/g, "/");
    const idx = norm.lastIndexOf("/");
    return idx >= 0
      ? { dir: norm.slice(0, idx + 1), name: norm.slice(idx + 1) }
      : { dir: "", name: norm };
  }

  return (
    <div className={styles.turnDiff}>
      <button
        type="button"
        className={`${styles.tdHead} pi-interactive`}
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDownOutline size={13} className={styles.tdChev} />
        ) : (
          <ChevronForwardOutline size={13} className={styles.tdChev} />
        )}
        <span className={styles.tdLabel}>{t.filesChangedCount(changes.files.length)}</span>
        <span className={styles.tdNums}>
          <span className={styles.tdAdd}>+{changes.totalAdditions}</span>
          <span className={styles.tdDel}>−{changes.totalDeletions}</span>
        </span>
      </button>
      {open ? (
        <ul className={styles.tdFiles}>
          {changes.files.map((file) => {
            const parts = splitPath(file.path);
            return (
              <li
                key={file.path}
                className={styles.tdFileRow}
                title={file.path}
                onClick={() => onOpenFile(file.path)}
              >
                <span className={styles.tdFile}>
                  <span className={styles.tdDir}>{parts.dir}</span>
                  <span className={styles.tdName}>{parts.name}</span>
                </span>
                <span className={styles.tdAdd}>+{file.additions}</span>
                <span className={styles.tdDel}>−{file.deletions}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default TurnDiffSummary;
