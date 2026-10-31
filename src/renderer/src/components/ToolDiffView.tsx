import { useMemo, type ReactNode } from "react";
import { PatchDiff } from "@pierre/diffs/react";
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

/** diffs 自带深色底，工具卡片背景由消息区决定，这里统一成透明。
 *  color-scheme 必须钉成应用主题：diffs 的 :host 默认 light dark，会跟随系统偏好。 */
function surfaceCss(theme: "light" | "dark"): string {
  return `:host{color-scheme:${theme}}:host,[data-diff],[data-file],pre,code{--diffs-bg:transparent!important}`;
}

/** 与 markstream 代码块同源的 diff 渲染器（@pierre/diffs + shiki）。 */
export function ToolDiffView({ text, path, fallback }: Props): ReactNode {
  const theme = useAppearanceStore((state) => state.resolvedTheme);
  const patch = useMemo(() => normalizeDiffHunks(text, path), [text, path]);
  const options = useMemo(
    () => ({
      diffStyle: "unified" as const,
      diffIndicators: "bars" as const,
      overflow: "wrap" as const,
      disableFileHeader: true,
      themeType: theme === "dark" ? ("dark" as const) : ("light" as const),
      unsafeCSS: surfaceCss(theme === "dark" ? "dark" : "light"),
    }),
    [theme],
  );

  if (!patch) return <>{fallback}</>;
  return (
    <div className={styles.root}>
      <PatchDiff patch={patch} options={options} />
    </div>
  );
}

export default ToolDiffView;
