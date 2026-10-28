import { useMemo, type ReactNode } from "react";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { normalizeDiffHunks } from "@renderer/utils/diff-view-hunks";
import styles from "./ToolDiffView.module.css";

type Props = {
  /** 工具卡片里归一化后的 unified diff。 */
  text: string;
  path: string | null;
  /** 没有 hunk（不是 diff）时显示的纯文本。 */
  fallback: ReactNode;
};

/** 与 PR 详情页用同一个渲染器，保证两处的 diff 视觉一致。 */
export function ToolDiffView({ text, path, fallback }: Props): ReactNode {
  const theme = useAppearanceStore((state) => state.resolvedTheme);
  const hunks = useMemo(() => normalizeDiffHunks(text, path), [text, path]);
  /** 库按 data 引用重建整份 diff，引用不稳会让卡片每次重渲染都重算一遍。 */
  const data = useMemo(
    () =>
      hunks
        ? {
            oldFile: { fileName: path ?? "" },
            newFile: { fileName: path ?? "" },
            hunks: [hunks],
          }
        : null,
    [hunks, path],
  );

  if (!data) return <>{fallback}</>;
  return (
    <div className={styles.root}>
      <DiffView
        data={data}
        diffViewMode={DiffModeEnum.Unified}
        diffViewTheme={theme}
        diffViewHighlight={false}
        diffViewWrap={false}
        diffViewFontSize={12}
      />
    </div>
  );
}

export default ToolDiffView;
