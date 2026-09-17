/**
 * Pure model-picker helpers for the composer.
 *
 * Extracted from Composer.vue so the dropdown contract is unit-testable: the
 * picker holds hundreds of entries (many providers × many models) and two
 * separate bugs lived here — a menu that grew past the window with no scrolling,
 * and a menu that silently ignored clicks.
 */
import type { DropdownMenuProps } from "naive-ui";

/** One selectable model. */
export type ModelChoice = { label: string; value: string };

/** A provider group, or a bare model when a provider has a single entry. */
export type ModelSelectOption = ModelChoice | { label: string; key: string; children: ModelChoice[] };

/** Dropdown item shape consumed by naive-ui's NDropdown. */
export type ModelMenuItem = {
  label: string;
  key: string | number;
  type?: "group";
  children?: { label: string; key: string; props?: Record<string, unknown> }[];
  props?: Record<string, unknown>;
};

/** Flatten groups back into a single list (used for the current-model label). */
export function flatModelOptions(groups: ModelSelectOption[]): ModelChoice[] {
  return groups.flatMap((g) => ("children" in g ? g.children : [g]));
}

/**
 * Build the dropdown items, bolding the active model.
 *
 * `selected` is the `provider/modelId` key the composer currently has selected.
 */
export function buildModelMenu(
  groups: ModelSelectOption[],
  selected: string | null,
  selectedStyle = "font-weight: 600; color: var(--accent)",
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
          props: o.value === selected ? { style: selectedStyle } : undefined,
        })),
      };
    }
    return {
      label: group.label,
      key: group.value,
      props: group.value === selected ? { style: selectedStyle } : undefined,
    };
  });
}

/**
 * Menu props factory that makes a long model list usable.
 *
 * naive-ui's `menu-props` is a FUNCTION (`menuProps: Function` in Dropdown.mjs),
 * called as `menuProps(undefined, nodes)` and merged onto the dropdown menu node.
 * Passing a plain object throws `TypeError: menuProps is not a function` inside
 * renderPopoverBody — which broke the whole composer, not just the menu.
 *
 * A naive-ui dropdown does not scroll on its own: with hundreds of models it grew
 * past the window and the lower entries could not be reached. Capping the height
 * and letting the menu scroll keeps every model clickable, and
 * `overscroll-behavior: contain` stops the page behind it from scrolling too.
 */
export const MODEL_MENU_PROPS: DropdownMenuProps = () =>
  ({
    scrollable: true,
    style: "max-height: min(60vh, 460px); overflow-y: auto; overscroll-behavior: contain;",
  }) as unknown as ReturnType<DropdownMenuProps>;
