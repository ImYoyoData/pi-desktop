import { useEffect, type ReactNode } from "react";
import { Empty } from "antd";
import FilesTab from "@renderer/components/FilesTab";
import PageSplit from "@renderer/components/PageSplit";
import PreviewTab from "@renderer/components/PreviewTab";
import TabStrip from "@renderer/components/TabStrip";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./FilesPage.module.css";

type Props = {
  visible: boolean;
  sideWidth: number;
  sideMinWidth: number;
  sideMaxWidth: number;
  onSideWidthChange: (width: number) => void;
};

/** 文件页：左侧文件树 + 右侧文件预览/编辑。 */
export function FilesPage({
  visible,
  sideWidth,
  sideMinWidth,
  sideMaxWidth,
  onSideWidthChange,
}: Props): ReactNode {
  const t = useI18n();
  const rightTabs = useRightTabsStore();
  const workspace = useWorkspaceStore();

  const previewTabs = rightTabs.dockTabs.filter((tab) => tab.kind === "preview");
  // 当前激活的是别的页面的标签时，文件页显示最后打开的那个预览。
  const activeId = previewTabs.some((tab) => tab.id === rightTabs.activeId)
    ? rightTabs.activeId
    : (previewTabs[previewTabs.length - 1]?.id ?? "");

  useEffect(() => {
    void useRightTabsStore.getState().refreshPreviewGitMeta();
  }, [workspace.root]);

  return (
    <PageSplit
      width={sideWidth}
      onWidthChange={onSideWidthChange}
      minWidth={sideMinWidth}
      maxWidth={sideMaxWidth}
      side={<FilesTab embedded />}
    >
      <TabStrip tabs={previewTabs} activeId={activeId} />
      <div className={styles.panels}>
        {previewTabs.length === 0 ? (
          <Empty
            className={styles.empty}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t.previewHint}
          />
        ) : (
          previewTabs.map((tab) => (
            <div
              key={tab.id}
              className={styles.panel}
              style={tab.id === activeId ? undefined : { display: "none" }}
            >
              <PreviewTab
                tabId={tab.id}
                filePath={tab.filePath ?? null}
                active={visible && tab.id === activeId}
              />
            </div>
          ))
        )}
      </div>
    </PageSplit>
  );
}

export default FilesPage;
