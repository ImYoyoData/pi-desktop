import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUndoOutline } from "@renderer/components/icons/ionicons";
import { useLayoutStore } from "@renderer/stores/layout";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";

import { fileIcon, type FileIcon } from "@renderer/utils/file-icon";
import {
  useDialog,
  useMessage,
  type DialogHandle,
} from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./RightDockChanges.module.css";

type Props = {
  /** False while the dock is hidden — defer git refreshes. */
  visible?: boolean;
};

type ChangeType = "added" | "modified" | "deleted";

type GitRow = {
  relativePath: string;
  code: string;
  ignored?: boolean;
  additions?: number | null;
  deletions?: number | null;
};

type ChangeRow = {
  path: string;
  changeType: ChangeType;
  icon: FileIcon;
  additions: number | null;
  deletions: number | null;
};

function changeTypeForCode(code: string | null | undefined): ChangeType {
  switch (code) {
    case "A":
    case "U":
    case "C":
      return "added";
    case "D":
      return "deleted";
    default:
      return "modified";
  }
}

function fileName(p: string): string {
  return p.split("/").pop() ?? p;
}

function fileDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "";
}

function badgeLetter(changeType: ChangeType): string {
  return changeType === "added" ? "A" : changeType === "deleted" ? "D" : "M";
}

export function RightDockChanges({ visible = true }: Props): ReactNode {
  const t = useI18n();
  const workspace = useWorkspaceStore();
  const message = useMessage();
  const dialog = useDialog();

  const [gitLoading, setGitLoading] = useState(false);
  const [gitFiles, setGitFiles] = useState<GitRow[]>([]);
  const fsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  async function refreshGit(): Promise<void> {
    if (!useWorkspaceStore.getState().root) {
      setGitFiles([]);
      return;
    }
    setGitLoading(true);
    try {
      const status = await window.api.git.status();
      const files = status.isGitRepository
        ? (status.files as GitRow[]).filter((f) => !f.ignored)
        : [];
      setGitFiles(files);
    } catch {
      // Transient git hiccup (index.lock, …) — keep the last known list.
    } finally {
      setGitLoading(false);
    }
  }

  const rows = useMemo<ChangeRow[]>(
    () =>
      gitFiles.map((f) => ({
        path: f.relativePath,
        changeType: changeTypeForCode(f.code),
        icon: fileIcon(f.relativePath),
        additions: f.additions ?? null,
        deletions: f.deletions ?? null,
      })),
    [gitFiles],
  );

  function openDiff(row: ChangeRow): void {
    useRightTabsStore.getState().revealInChanges(row.path);
    if (useLayoutStore.getState().rightCollapsed) useLayoutStore.getState().toggleRightCollapsed();
  }

  function formatGitError(result: { message: string; code?: string }): string {
    const key = `gitErr_${result.code || "unknown"}` as keyof typeof t;
    return typeof t[key] === "string" ? (t[key] as string) : t.gitErr_unknown;
  }

  function onDiscard(row: ChangeRow): void {
    const d: DialogHandle = dialog.warning({
      title: t.changesDiscardFile,
      content: t.changesDiscardConfirmFile,
      positiveText: t.confirm,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        return (async () => {
          try {
            const result = await window.api.git.restore([row.path]);
            if (!result.ok) {
              message.error(formatGitError(result));
              return false;
            }
            message.success(t.changesDiscarded);
            await refreshGit();
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          }
        })();
      },
    });
  }

  useEffect(() => {
    void refreshGit();
    const onFsChanged = (): void => {
      if (!useWorkspaceStore.getState().root || !visibleRef.current) return;
      if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
      fsTimerRef.current = setTimeout(() => {
        fsTimerRef.current = null;
        void refreshGit();
      }, 400);
    };
    window.addEventListener("pi-fs-changed", onFsChanged);
    return () => {
      window.removeEventListener("pi-fs-changed", onFsChanged);
      if (fsTimerRef.current) clearTimeout(fsTimerRef.current);
      fsTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    void refreshGit();
  }, [workspace.root]);

  useEffect(() => {
    if (visible) void refreshGit();
  }, [visible]);

  return (
    <div className={styles.changesViewBody}>
      {gitLoading ? <div className={styles.changesProgress} aria-hidden="true" /> : null}

      {rows.length ? (
        <ul className={styles.changesFileList}>
          {rows.map((row) => (
            <li
              key={row.path}
              className={styles.row}
              title={row.path}
              onClick={() => openDiff(row)}
            >
              <span
                className={styles.fileIcon}
                style={row.icon.color ? { color: row.icon.color } : undefined}
                aria-hidden="true"
              >
                {row.icon.glyph}
              </span>
              <span className={styles.label}>
                <span
                  className={
                    row.changeType === "deleted"
                      ? `${styles.name} ${styles.strike}`
                      : styles.name
                  }
                >
                  {fileName(row.path)}
                </span>
                {fileDir(row.path) ? (
                  <span className={styles.desc}>{fileDir(row.path)}</span>
                ) : null}
              </span>
              {row.additions !== null ? (
                <span className={styles.workingSetLineCounts}>
                  <span className={styles.linesAdded}>+{row.additions}</span>
                  <span className={styles.linesRemoved}>-{row.deletions}</span>
                </span>
              ) : null}
              <span className={styles.chatCollapsibleListActionBar}>
                <button
                  type="button"
                  className={styles.action}
                  title={t.changesDiscardFile}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDiscard(row);
                  }}
                >
                  <ArrowUndoOutline size={13} />
                </button>
              </span>
              <span
                className={`${styles.changesDecorationBadge} ${
                  row.changeType === "added"
                    ? styles.added
                    : row.changeType === "deleted"
                      ? styles.deleted
                      : styles.modified
                }`}
              >
                {badgeLetter(row.changeType)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.changesWelcome}>
          <h2 className={styles.sessionsEmptyStateTitle}>{t.changesWelcomeTitle}</h2>
          <div className={styles.sessionsEmptyStateDescription}>{t.changesWelcomeEmpty}</div>
        </div>
      )}
    </div>
  );
}

export default RightDockChanges;
