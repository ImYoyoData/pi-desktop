import { useState, type ReactNode } from "react";
import DiffTab from "@renderer/components/DiffTab";
import PageHeader from "@renderer/components/PageHeader";
import PageSplit from "@renderer/components/PageSplit";
import RightDockChanges from "@renderer/components/RightDockChanges";
import { useRightDockStore } from "@renderer/stores/right-dock";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ChangesPage.module.css";

type Props = {
  visible: boolean;
  sideWidth: number;
  sideMinWidth: number;
  sideMaxWidth: number;
  onSideWidthChange: (width: number) => void;
};

/** 更改页：左侧该文件的 diff + 右侧改动列表。 */
export function ChangesPage({
  visible,
  sideWidth,
  sideMinWidth,
  sideMaxWidth,
  onSideWidthChange,
}: Props): ReactNode {
  const changesPath = useRightDockStore((state) => state.changesPath);
  const t = useI18n();
  const [sideHidden, setSideHidden] = useState(false);

  return (
    <div className={styles.root}>
      <PageHeader
        title={t.changesTab}
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
        side={
          <RightDockChanges
            visible={visible}
            selectedPath={changesPath}
            onSelect={(path) => useRightDockStore.getState().showChanges(path)}
          />
        }
      >
        <div className={styles.diff}>
          <DiffTab filePath={changesPath || null} visible={visible} />
        </div>
      </PageSplit>
    </div>
  );
}

export default ChangesPage;
