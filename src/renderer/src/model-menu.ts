/**
 * Pure model-picker helpers for the composer.
 *
 * Extracted from Composer.vue so the dropdown contract is unit-testable: the
 * picker holds hundreds of entries (many providers × many models) and two
 * separate bugs lived here — a menu that grew past the window with no scrolling,
 * and a menu that silently ignored clicks.
 */
import type { MenuProps } from "antd";
import type { CSSProperties } from "react";

/** One selectable model. */
export type ModelChoice = { label: string; value: string };

/** A provider group, or a bare model when a provider has a single entry. */
export type ModelSelectOption = ModelChoice | { label: string; key: string; children: ModelChoice[] };

/** Dropdown item shape consumed by antd's Dropdown menu. */
export type ModelMenuItem = NonNullable<MenuProps["items"]>[number];

/** Flatten groups back into a single list (used for the current-model label). */
export function flatModelOptions(groups: ModelSelectOption[]): ModelChoice[] {
  return groups.flatMap((g) => ("children" in g ? g.children : [g]));
}

/** 当前模型的强调样式：与侧栏选中态同一套浅灰底，不着重色。 */
export const SELECTED_MODEL_STYLE: CSSProperties = {
  background: "var(--bg-active)",
  borderRadius: "var(--radius-sm, 4px)",
};

/**
 * Build the dropdown items, highlighting the active model.
 *
 * `selected` is the `provider/modelId` key the composer currently has selected.
 */
export function buildModelMenu(
  groups: ModelSelectOption[],
  selected: string | null,
  selectedStyle: CSSProperties = SELECTED_MODEL_STYLE,
): ModelMenuItem[] {
  return groups.map((group) => {
    if ("children" in group) {
      return {
        type: "group" as const,
        label: group.label,
        key: group.key,
        children: group.children.map((o) => ({
          label: o.label,
          key: o.value,
          style: o.value === selected ? selectedStyle : undefined,
        })),
      };
    }
    return {
      label: group.label,
      key: group.value,
      style: group.value === selected ? selectedStyle : undefined,
    };
  });
}

/**
 * Menu props factory that makes a long model list usable.
 *
 * antd 的下拉菜单不会自己滚动：模型条目上百个时会撑出窗口，底部的条目点不到。
 * 限制高度并让菜单自身滚动，保证每个模型都够得着；`overscroll-behavior: contain`
 * 同时阻止背后的页面跟着滚。
 */
export const MODEL_MENU_PROPS: MenuProps = {
  style: {
    maxHeight: "min(60vh, 460px)",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
};
