import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createDiffSurface, type DiffSurfaceController } from "stream-diffs";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { fontSizePx, resolveMonoFontStack } from "../../../shared/appearance";
import styles from "./ChangesDiffView.module.css";

type Props = {
  /** 主进程算好的 unified patch，渲染层不再重算 diff。 */
  patch: string;
};

/** diffs 内部底色跟着右侧栏走；不覆盖变量的话上下文行仍是主题自带底色。 */
const SURFACE_CSS = `:host,[data-diff],[data-file],pre,code{--diffs-bg:#1a1a19!important}`;

/** 更改页 diff：stream-diffs 按 patch 渲染，只高亮改动 hunk。 */
export function ChangesDiffView({ patch }: Props): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<DiffSurfaceController | null>(null);
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme);
  const fontSize = useAppearanceStore((s) => s.fontSize);
  const fonts = useAppearanceStore((s) => s.fonts);
  const fontPx = fontSizePx(12.5, fontSize);
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const controller = createDiffSurface({
      kind: "patch",
      patch,
      options: {
        diffStyle: "unified",
        diffIndicators: "bars",
        themeType: themeRef.current === "dark" ? "dark" : "light",
        unsafeCSS: SURFACE_CSS,
      },
    });
    controllerRef.current = controller;
    void controller.mount(host).catch(() => {});
    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, [patch]);

  useEffect(() => {
    controllerRef.current?.setThemeType(resolvedTheme === "dark" ? "dark" : "light");
  }, [resolvedTheme]);

  const hostStyle = {
    "--diffs-font-size": `${fontPx}px`,
    "--diffs-line-height": `${Math.round(fontPx * 1.6)}px`,
    "--diffs-font-family": resolveMonoFontStack(fonts),
  } as CSSProperties;

  return <div ref={hostRef} className={styles.host} style={hostStyle} />;
}

export default ChangesDiffView;
