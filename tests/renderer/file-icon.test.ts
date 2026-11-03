import { describe, expect, it, vi } from "vitest";
import { fileIcon } from "../../src/renderer/src/utils/file-icon";

describe("fileIcon 行内选择器", () => {
  it("read 工具的行号选择器不应污染扩展名", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ set textContent(_v: string) {} }),
      head: { appendChild: vi.fn() },
    });
    const ts = fileIcon("session-widgets.ts");
    expect(ts.glyph).not.toBe("");
    expect(fileIcon("session-widgets.ts:1-15,194-215").glyph).toBe(ts.glyph);
    expect(fileIcon("session-widgets.ts:12").glyph).toBe(ts.glyph);
    expect(fileIcon("session-widgets.ts:50-").glyph).toBe(ts.glyph);
    expect(fileIcon("session-widgets.ts:raw").glyph).toBe(ts.glyph);
    expect(fileIcon("session-widgets.ts:raw:50-100").glyph).toBe(ts.glyph);
    expect(fileIcon("session-widgets.ts:conflicts").glyph).toBe(ts.glyph);
  });

  it("不同语言的文件图标不同", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ set textContent(_v: string) {} }),
      head: { appendChild: vi.fn() },
    });
    expect(fileIcon("main.ts").glyph).not.toBe(fileIcon("main.py").glyph);
    expect(fileIcon("main.py:1-20").glyph).toBe(fileIcon("main.py").glyph);
  });

  it("Windows 盘符与普通冒号不被当成选择器", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ set textContent(_v: string) {} }),
      head: { appendChild: vi.fn() },
    });
    const win = fileIcon("D:\\src\\main.ts");
    expect(win.glyph).toBe(fileIcon("main.ts").glyph);
    expect(fileIcon("D:\\src\\main.ts:12").glyph).toBe(win.glyph);
  });
});
