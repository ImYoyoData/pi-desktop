import { type ReactNode } from "react";
import DiffTab from "@renderer/components/DiffTab";
import PageSplit from "@renderer/components/PageSplit";
import RightDockChanges from "@renderer/components/RightDockChanges";
import { useRightDockStore } from "@renderer/stores/right-dock";
import styles from "./ChangesPage.module.css";

type Props = {
  visible: boolean;
  sideWidth: number;
  sideMinWidth: number;
  sideMaxWidth: number;
  onSideWidthChange: (width: number) => void;
};

/** 更改页：左侧改动列表 + 右侧该文件的 diff。 */
export function ChangesPage({
  visible,
  sideWidth,
  sideMinWidth,
  sideMaxWidth,
  onSideWidthChange,
}: Props): ReactNode {
  const changesPath = useRightDockStore((state) => state.changesPath);

  return (
    <PageSplit
      width={sideWidth}
      onWidthChange={onSideWidthChange}
      minWidth={sideMinWidth}
      maxWidth={sideMaxWidth}
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
  );
}

export default ChangesPage;
