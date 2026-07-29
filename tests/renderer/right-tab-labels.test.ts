import { describe, expect, it } from "vitest";
import { localizedTabLabel } from "../../src/renderer/src/utils/right-tab-labels";
import { t } from "../../src/renderer/src/i18n";

describe("localizedTabLabel", () => {
  it("maps fixed singleton kinds to active locale", () => {
    expect(
      localizedTabLabel({ id: "1", kind: "running", label: "运行" }),
    ).toBe(t.runningTab);
    expect(
      localizedTabLabel({ id: "2", kind: "changes", label: "更改" }),
    ).toBe(t.changesTab);
    expect(
      localizedTabLabel({ id: "3", kind: "files", label: "文件" }),
    ).toBe(t.filesTab);
  });

  it("re-localizes default browser/terminal titles", () => {
    expect(
      localizedTabLabel({ id: "b1", kind: "browser", label: "浏览器" }),
    ).toBe(t.browser);
    expect(
      localizedTabLabel({ id: "b2", kind: "browser", label: "浏览器 2" }),
    ).toBe(t.browserLabel(2));
    expect(
      localizedTabLabel({ id: "t1", kind: "terminal", label: "终端" }),
    ).toBe(t.terminal);
  });

  it("keeps locked and custom titles", () => {
    expect(
      localizedTabLabel({
        id: "b3",
        kind: "browser",
        label: "浏览器",
        labelLocked: true,
      }),
    ).toBe("浏览器");
    expect(
      localizedTabLabel({ id: "b4", kind: "browser", label: "GitHub" }),
    ).toBe("GitHub");
  });
});
