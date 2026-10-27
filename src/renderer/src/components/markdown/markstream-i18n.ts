import { setDefaultI18nMap } from "markstream-react";
import type { Messages } from "@renderer/i18n";

/**
 * markstream 自带的按钮文案（复制、缩放、导出、全屏）走它自己的默认表，
 * 默认是英文；这里用当前语言的文案覆盖，避免中英混排。
 */
export function applyMarkstreamMessages(t: Messages): void {
  setDefaultI18nMap({
    "common.copy": t.copy,
    "common.copied": t.copied,
    "common.zoomIn": t.mdDiagramZoomIn,
    "common.zoomOut": t.mdDiagramZoomOut,
    "common.resetZoom": t.mdDiagramZoomReset,
    "common.expand": t.mdDiagramExpand,
    "common.source": t.mdDiagramCopySource,
    "common.export": t.mdDiagramDownloadSvg,
  });
}
