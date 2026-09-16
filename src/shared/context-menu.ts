/** 右键编辑菜单：主进程把原生 context-menu 参数转成数据发给渲染进程自绘。 */

import type { EditMenuLabels } from "./edit-menu-i18n";

export interface EditContextMenuPayload {
  x: number;
  y: number;
  isEditable: boolean;
  labels: EditMenuLabels;
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canDelete: boolean;
  canSelectAll: boolean;
}

export type EditContextMenuAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll";
