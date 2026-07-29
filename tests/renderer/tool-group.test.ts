import { describe, expect, it } from "vitest";
import {
  buildToolGroupSpans,
  countToolActivities,
  formatToolGroupSummary,
} from "../../src/renderer/src/utils/tool-group";

describe("buildToolGroupSpans", () => {
  const groupable = (m: { toolName: string }) => m.toolName !== "ask_user";

  it("groups consecutive tools of length >= 2", () => {
    const messages = [
      { id: "a", role: "assistant", toolName: "" },
      { id: "t1", role: "tool", toolName: "read" },
      { id: "t2", role: "tool", toolName: "bash" },
      { id: "t3", role: "tool", toolName: "read" },
      { id: "b", role: "assistant", toolName: "" },
      { id: "t4", role: "tool", toolName: "read" },
    ];
    expect(buildToolGroupSpans(messages, groupable)).toEqual([
      {
        groupId: "tg:t1",
        start: 1,
        end: 4,
        ids: ["t1", "t2", "t3"],
      },
    ]);
  });

  it("breaks on non-groupable tools", () => {
    const messages = [
      { id: "t1", role: "tool", toolName: "read" },
      { id: "ask", role: "tool", toolName: "ask_user" },
      { id: "t2", role: "tool", toolName: "bash" },
      { id: "t3", role: "tool", toolName: "read" },
    ];
    expect(buildToolGroupSpans(messages, groupable)).toEqual([
      {
        groupId: "tg:t2",
        start: 2,
        end: 4,
        ids: ["t2", "t3"],
      },
    ]);
  });
});

describe("formatToolGroupSummary", () => {
  const parts = {
    readTimes: (n: number) => `读取文件${n}次`,
    toolTimes: (n: number) => `调用工具${n}次`,
    join: (xs: string[]) => xs.join("、"),
  };

  it("matches cursor-style summary order", () => {
    expect(
      formatToolGroupSummary(
        countToolActivities([
          { toolName: "bash" },
          { toolName: "bash" },
          { toolName: "read" },
          { toolName: "read" },
          { toolName: "read" },
          { toolName: "read" },
        ]),
        parts,
      ),
    ).toBe("调用工具2次、读取文件4次");
  });

  it("counts non-read tools together", () => {
    expect(
      formatToolGroupSummary(
        countToolActivities([{ toolName: "edit" }, { toolName: "mcp_foo" }]),
        parts,
      ),
    ).toBe("调用工具2次");
  });
});
