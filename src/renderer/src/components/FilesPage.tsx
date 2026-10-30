import { useEffect, type ReactNode } from "react";
import FilesTab from "@renderer/components/FilesTab";
import PageSplit from "@renderer/components/PageSplit";
import PreviewTab from "@renderer/components/PreviewTab";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { fileIcon } from "@renderer/utils/file-icon";
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
  const rightTabs = useRightTabsStore();
  const workspaceRoot = useWorkspaceStore((s) => s.root);

  const previewTabs = rightTabs.dockTabs.filter((tab) => tab.kind === "preview");
  // 当前激活的是别的页面的标签时，文件页显示最后打开的那个预览。
  const activeId = previewTabs.some((tab) => tab.id === rightTabs.activeId)
    ? rightTabs.activeId
    : (previewTabs[previewTabs.length - 1]?.id ?? "");

  useEffect(() => {
    void useRightTabsStore.getState().refreshPreviewGitMeta();
  }, [workspaceRoot]);

  const activeTab = previewTabs.find((tab) => tab.id === activeId);
  const activeIcon = activeTab?.filePath ? fileIcon(activeTab.filePath) : null;
  const activeColor = activeTab?.missing
    ? gitCodeColor("D")
    : activeTab?.gitCode
      ? gitCodeColor(activeTab.gitCode)
      : activeTab?.dirty
        ? gitCodeColor("M")
        : undefined;

  return (
    <PageSplit
      width={sideWidth}
      onWidthChange={onSideWidthChange}
      minWidth={sideMinWidth}
      maxWidth={sideMaxWidth}
      sidePosition="end"
      side={<FilesTab embedded />}
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
        </div>
      ) : null}
      <div className={styles.panels}>
        {previewTabs.map((tab) => (
          <div
            key={tab.id}
            className={styles.panel}
            style={tab.id === activeId ? undefined : { display: "none" }}
          >
            <PreviewTab
              tabId={tab.id}
              filePath={tab.filePath ?? null}
              active={visible && tab.id === activeId}
              hideToolbar
            />
          </div>
        ))}
      </div>
    </PageSplit>
  );
}

export default FilesPage;
