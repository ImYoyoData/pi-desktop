import { describe, expect, it } from "vitest";
import {
  MODEL_MENU_PROPS,
  buildModelMenu,
  flatModelOptions,
  type ModelSelectOption,
} from "../../src/renderer/src/model-menu";

/**
 * The composer's model picker holds hundreds of entries. Two regressions lived in
 * this code: a menu that grew past the window with no way to scroll, and a picker
 * whose click handler silently returned while a turn was running.
 */
describe("buildModelMenu", () => {
  it("keeps provider groups with their children", () => {
    const groups: ModelSelectOption[] = [
      {
        label: "Anthropic",
        key: "anthropic",
        children: [
          { label: "Claude Sonnet", value: "anthropic/claude-sonnet" },
          { label: "Claude Opus", value: "anthropic/claude-opus" },
        ],
      },
      { label: "Local", value: "local/llama" },
    ];
    const menu = buildModelMenu(groups, "anthropic/claude-opus");
    expect(menu).toHaveLength(2);
    expect(menu[0]).toMatchObject({ type: "group", label: "Anthropic", key: "anthropic" });
    expect(menu[0]?.children?.map((c) => c.key)).toEqual([
      "anthropic/claude-sonnet",
      "anthropic/claude-opus",
    ]);
    expect(menu[1]).toMatchObject({ label: "Local", key: "local/llama" });
  });

  it("bolds only the currently selected model", () => {
    const groups: ModelSelectOption[] = [
      {
        label: "P",
        key: "p",
        children: [
          { label: "A", value: "p/a" },
          { label: "B", value: "p/b" },
        ],
      },
    ];
    const menu = buildModelMenu(groups, "p/b");
    expect(menu[0]?.children?.[0]?.props).toBeUndefined();
    expect(menu[0]?.children?.[1]?.props?.style).toContain("font-weight: 600");
  });

  it("emits a stable key for every entry so selects resolve", () => {
    const groups: ModelSelectOption[] = [
      { label: "Solo", value: "provider/solo" },
      { label: "G", key: "g", children: [{ label: "X", value: "g/x" }] },
    ];
    const menu = buildModelMenu(groups, "");
    const keys = [menu[0]?.key, menu[1]?.key, menu[1]?.children?.[0]?.key];
    expect(keys).toEqual(["provider/solo", "g", "g/x"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("handles an empty model list without throwing", () => {
    expect(buildModelMenu([], "")).toEqual([]);
  });
});

describe("flatModelOptions", () => {
  it("flattens groups and passes bare models through", () => {
    const groups: ModelSelectOption[] = [
      { label: "G", key: "g", children: [{ label: "X", value: "g/x" }] },
      { label: "Solo", value: "p/solo" },
    ];
    expect(flatModelOptions(groups).map((o) => o.value)).toEqual(["g/x", "p/solo"]);
  });
});

describe("MODEL_MENU_PROPS", () => {
  it("is a FUNCTION because naive-ui calls menu-props", () => {
    // Passing an object threw `TypeError: menuProps is not a function` inside
    // naive-ui's renderPopoverBody and broke the entire composer.
    expect(typeof MODEL_MENU_PROPS).toBe("function");
  });

  it("caps the menu height and makes it scroll", () => {
    const props = MODEL_MENU_PROPS() as { style?: string; scrollable?: boolean };
    expect(props.style).toContain("max-height");
    expect(props.style).toContain("overflow-y: auto");
    expect(props.scrollable).toBe(true);
  });

  it("contains overscroll so the page behind does not move", () => {
    const props = MODEL_MENU_PROPS() as { style?: string };
    expect(props.style).toContain("overscroll-behavior: contain");
  });
});
