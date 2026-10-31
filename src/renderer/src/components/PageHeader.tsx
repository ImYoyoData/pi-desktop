import type { ReactNode } from "react";
import { CloseOutline, ExpandOutline } from "@renderer/components/icons/ionicons";
import { FileListIcon } from "@renderer/components/icons/TitleBarIcons";
import { useLayoutStore } from "@renderer/stores/layout";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PageHeader.module.css";

type Props = {
  title: string;
  sideHidden?: boolean;
  /** 不传则不显示“收起列表”按钮。 */
  onToggleSide?: () => void;
};

/** 右栏页面标题栏：标题 + 收起列表 / 最大化编辑器 / 关闭右栏。 */
export function PageHeader({ title, sideHidden, onToggleSide }: Props): ReactNode {
  const t = useI18n();
  const layout = useLayoutStore();

  return (
    <div className={styles.root}>
      <span className={styles.title}>{title}</span>
      <div className={styles.actions}>
        {onToggleSide ? (
          <button
            type="button"
            className={styles.action}
            title={sideHidden ? t.expandFileList : t.collapseFileList}
            aria-label={sideHidden ? t.expandFileList : t.collapseFileList}
            aria-pressed={sideHidden}
            onClick={onToggleSide}
          >
            <FileListIcon size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className={styles.action}
          title={t.maximizeEditor}
          aria-label={t.maximizeEditor}
          onClick={() => layout.toggleEditorMaximized()}
        >
          <ExpandOutline size={16} />
        </button>
        <button
          type="button"
          className={styles.action}
          title={t.close}
          aria-label={t.close}
          onClick={() => layout.toggleRightCollapsed()}
        >
          <CloseOutline size={16} />
        </button>
      </div>
    </div>
  );
}

export default PageHeader;
