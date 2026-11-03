import { describe, expect, it } from "vitest";
import { buildUserRowView } from "../../src/renderer/src/utils/message-user";
import type { UserMessage } from "../../src/renderer/src/utils/message-rows";

const LEGACY_MODE_BLOCK = "[pi-desktop mode: agent]\nYou are in **Agent mode**.\n- rule";

function msg(partial: Partial<UserMessage>): UserMessage {
  return { id: "u1", role: "user", text: "hello", ...partial };
}

describe("buildUserRowView", () => {
  it("strips the legacy mode block from the visible text", () => {
    const text = `${LEGACY_MODE_BLOCK}\n\n真正的提问`;
    expect(buildUserRowView(msg({ text })).text).toBe("真正的提问");
  });

  it("leaves plain text untouched", () => {
    expect(buildUserRowView(msg({ text: "普通提问" })).text).toBe("普通提问");
  });

  it("drops mode marker tags but keeps file and url tags", () => {
    const view = buildUserRowView(
      msg({
        elementTags: [
          { url: "a", host: "h", label: "agent", kind: "agent" },
          { url: "f", host: "h", label: "a.ts", kind: "file" },
          { url: "https://x.dev", host: "x.dev", label: "x", kind: "url" },
        ],
      }),
    );
    expect(view.tags.map((tag) => tag.label)).toEqual(["a.ts", "x"]);
  });

  it("needs a toggle for long text", () => {
    expect(buildUserRowView(msg({ text: "x".repeat(141) })).needsToggle).toBe(true);
    expect(buildUserRowView(msg({ text: "x".repeat(140) })).needsToggle).toBe(false);
  });

  it("tolerates a message with no tags", () => {
    expect(buildUserRowView(msg({})).tags).toEqual([]);
  });
});