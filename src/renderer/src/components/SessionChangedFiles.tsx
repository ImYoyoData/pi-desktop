import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
} from "@renderer/components/icons/ionicons";
import { fileIcon } from "@renderer/utils/file-icon";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useLayoutStore } from "@renderer/stores/layout";
import { useSessionFileChanges } from "@renderer/utils/use-session-file-changes";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./SessionChangedFiles.module.css";

/**
 * Copilot chat-editing "working set" — files the agent touched this session,
 * docked on the chat input stack above the composer. Header shows "<N> files
 * changed" + an aggregate +added/-removed pill (Copilot `.working-set-title`
 * + `.working-set-line-counts`); expanding lists every path with its own
 * +/- counts; clicking a row previews the file.
 *
 * Row data (transcript aggregate merged with the real net per-file stats)
 * comes from `useSessionFileChanges`, shared with the right-pane Changes
 * dock view.
 */

type BodyPhase = "hidden" | "enter" | "shown" | "leave";

const EXPAND_ANIM_MS = 140;

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

export function SessionChangedFiles(): ReactNode {
  const t = useI18n();
  const { files } = useSessionFileChanges();

  const rows = useMemo(
    () => files.map((f) => ({ ...f, icon: fileIcon(f.path) })),
    [files],
  );

  const [collapsed, setCollapsed] = useState(true);
  const [phase, setPhase] = useState<BodyPhase>("hidden");
  const phaseTimer = useRef(0);

  useEffect(() => {
    return () => window.clearTimeout(phaseTimer.current);
  }, []);

  const totalAdditions = useMemo(
    () => files.reduce((n, f) => n + f.additions, 0),
    [files],
  );
  const totalDeletions = useMemo(
    () => files.reduce((n, f) => n + f.deletions, 0),
    [files],
  );

  const title =
    files.length === 0 ? t.filesChanged : t.filesChangedCount(files.length);

  const toggle = useCallback((): void => {
    window.clearTimeout(phaseTimer.current);
    if (collapsed) {
      setCollapsed(false);
      setPhase("enter");
      phaseTimer.current = window.setTimeout(
        () => setPhase("shown"),
        EXPAND_ANIM_MS,
      );
      return;
    }
    setCollapsed(true);
    setPhase("leave");
    phaseTimer.current = window.setTimeout(
      () => setPhase("hidden"),
      EXPAND_ANIM_MS,
    );
  }, [collapsed]);

  const openFile = useCallback((p: string): void => {
    usePreviewStore.getState().openPreview(p);
    useRightTabsStore.getState().addTab("preview", {
      filePath: p,
      label: basename(p),
    });
    const layout = useLayoutStore.getState();
    if (layout.rightCollapsed) layout.toggleRightCollapsed();
  }, []);

  if (!files.length) return null;

  return (
    <div className={`files-dock ${styles.filesDock}`} role="region" aria-label={title}>
      <div className={styles.filesDockHead}>
        <button
          type="button"
          className={`pi-interactive ${styles.filesDockToggle}`}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.filesExpand : t.filesCollapse}
          onClick={toggle}
        >
          {collapsed ? (
            <ChevronForwardOutline className={styles.chev} size={13} />
          ) : (
            <ChevronDownOutline className={styles.chev} size={13} />
          )}
          <span className={styles.filesTitle}>{title}</span>
          {totalAdditions || totalDeletions ? (
            <span className={styles.filesLineCounts}>
              {totalAdditions ? (
                <span className={styles.linesAdded}>+{totalAdditions}</span>
              ) : null}
              {totalDeletions ? (
                <span className={styles.linesRemoved}>-{totalDeletions}</span>
              ) : null}
            </span>
          ) : null}
        </button>
      </div>

      {phase === "hidden" ? null : (
        <div
          className={`${styles.filesDockBody} ${phase === "enter" ? styles.bodyEnter : ""} ${phase === "leave" ? styles.bodyLeave : ""}`}
        >
          <ul className={styles.filesList} role="list">
            {rows.map((f) => (
              <li
                key={f.path}
                className={styles.filesItem}
                role="listitem"
                onClick={() => openFile(f.path)}
              >
                <span
                  className={styles.fileGlyph}
                  style={f.icon.color ? { color: f.icon.color } : undefined}
                  aria-hidden="true"
                >
                  {f.icon.glyph}
                </span>
                <span className={styles.filePath} title={f.path}>
                  {basename(f.path)}
                </span>
                <span className={styles.filesItemCounts}>
                  {f.additions ? (
                    <span className={styles.linesAdded}>+{f.additions}</span>
                  ) : null}
                  {f.deletions ? (
                    <span className={styles.linesRemoved}>-{f.deletions}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SessionChangedFiles;
