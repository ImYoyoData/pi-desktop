import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import FilesTab from "@renderer/components/FilesTab";
import PageHeader from "@renderer/components/PageHeader";
import PageSplit from "@renderer/components/PageSplit";
import PreviewTab, { type MdViewMode } from "@renderer/components/PreviewTab";
import { HighlightWorkerPool } from "@renderer/components/ShikiEditor";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { gitCodeColor, languageFromPath } from "@renderer/utils/editor-lang";
import { fileIcon } from "@renderer/utils/file-icon";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./FilesPage.module.css";

type Props = {
  visible: boolean;
  sideWidth: number;
  sideMinWidth: number;
  sideMaxWidth: number;
  onSideWidthChange: (width: number) => void;
};

/** 文件页：左侧文件预览/编辑 + 右侧文件树。 */
export function FilesPage({
  visible,
  sideWidth,
  sideMinWidth,
  sideMaxWidth,
  onSideWidthChange,
}: Props): ReactNode {
  const dockTabs = useRightTabsStore((s) => s.dockTabs);
  const storeActiveId = useRightTabsStore((s) => s.activeId);
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const t = useI18n();
  const [sideHidden, setSideHidden] = useState(false);
  const [viewModes, setViewModes] = useState<Record<string, MdViewMode>>({});

  const previewTabs = useMemo(
    () => dockTabs.filter((tab) => tab.kind === "preview"),
    [dockTabs],
  );
  // 当前激活的是别的页面的标签时，文件页显示最后打开的那个预览。
  const activeId = previewTabs.some((tab) => tab.id === storeActiveId)
    ? storeActiveId
    : (previewTabs[previewTabs.length - 1]?.id ?? "");

  const setViewMode = useCallback((tabId: string, mode: MdViewMode): void => {
    setViewModes((current) => ({ ...current, [tabId]: mode }));
  }, []);

  // handler 按标签缓存：dockTabs 变化不重刷回调，预览标签的 memo 才有效。
  const handlerCache = useRef(new Map<string, (mode: MdViewMode) => void>());
  function viewModeHandler(tabId: string): (mode: MdViewMode) => void {
    const cached = handlerCache.current.get(tabId);
    if (cached) return cached;
    const handler = (mode: MdViewMode): void => setViewMode(tabId, mode);
    handlerCache.current.set(tabId, handler);
    return handler;
  }

  useEffect(() => {
    void useRightTabsStore.getState().refreshPreviewGitMeta();
  }, [workspaceRoot]);

  const activeTab = previewTabs.find((tab) => tab.id === activeId);
  const isMarkdown = activeTab?.filePath
    ? languageFromPath(activeTab.filePath) === "markdown"
    : false;
  const activeMode: MdViewMode = viewModes[activeId] ?? "preview";

  const activeIcon = activeTab?.filePath ? fileIcon(activeTab.filePath) : null;
  const activeColor = activeTab?.missing
    ? gitCodeColor("D")
    : activeTab?.gitCode
      ? gitCodeColor(activeTab.gitCode)
      : activeTab?.dirty
        ? gitCodeColor("M")
        : undefined;

  return (
    <div className={styles.root}>
      <PageHeader
        title={t.filesTab}
        sideHidden={sideHidden}
        onToggleSide={() => setSideHidden((current) => !current)}
      />
      <PageSplit
        width={sideWidth}
        onWidthChange={onSideWidthChange}
        minWidth={sideMinWidth}
        maxWidth={sideMaxWidth}
        sidePosition="end"
        sideHidden={sideHidden}
        side={<FilesTab embedded visible={visible} />}
      >
      {activeTab ? (
        <div className={styles.fileHead} title={activeTab.filePath ?? undefined}>
          {activeIcon ? (
            <span
              className={styles.fileGlyph}
              style={activeIcon.color ? { color: activeIcon.color } : undefined}
              aria-hidden="true"
            >
              {activeIcon.glyph}
            </span>
          ) : null}
          <span
            className={styles.fileName}
            style={activeColor ? { color: activeColor } : undefined}
          >
            {activeTab.label}
          </span>
          {isMarkdown ? (
            <div className={styles.viewModes} role="group" aria-label={t.mdPreview}>
              {(["edit", "split", "preview"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={
                    activeMode === mode
                      ? `${styles.viewMode} ${styles.viewModeActive}`
                      : styles.viewMode
                  }
                  onClick={() => setViewMode(activeId, mode)}
                >
                  {mode === "edit" ? t.mdEdit : mode === "split" ? t.mdSplit : t.mdPreview}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.panels}>
        {previewTabs.map((tab) =>
          tab.id === activeId || tab.dirty || tab.missing ? (
            <div
              key={tab.id}
              className={styles.panel}
              style={tab.id === activeId ? undefined : { display: "none" }}
            >
              <HighlightWorkerPool>
                <PreviewTab
                  tabId={tab.id}
                  filePath={tab.filePath ?? null}
                  active={visible && tab.id === activeId}
                  hideToolbar
                  viewMode={viewModes[tab.id] ?? "preview"}
                  onViewModeChange={viewModeHandler(tab.id)}
                />
              </HighlightWorkerPool>
            </div>
          ) : null,
        )}
      </div>
      </PageSplit>
    </div>
  );
}

export default FilesPage;
