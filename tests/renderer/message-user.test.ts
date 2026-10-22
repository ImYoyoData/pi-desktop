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

  it("needs a toggle for too many images or tags", () => {
    const imgs = (n: number): UserMessage["images"] =>
      Array.from({ length: n }, (_, i) => ({ dataUrl: `d${i}`, mimeType: "image/png" }));
    expect(buildUserRowView(msg({ text: "hi", images: imgs(3) })).needsToggle).toBe(true);
    expect(buildUserRowView(msg({ text: "hi", images: imgs(2) })).needsToggle).toBe(false);

    const tags = (n: number): NonNullable<UserMessage["elementTags"]> =>
      Array.from({ length: n }, (_, i) => ({ url: `u${i}`, host: "h", label: `l${i}` }));
    expect(buildUserRowView(msg({ text: "hi", elementTags: tags(5) })).needsToggle).toBe(true);
    expect(buildUserRowView(msg({ text: "hi", elementTags: tags(4) })).needsToggle).toBe(false);
  });

  it("does not count dropped mode tags toward the toggle threshold", () => {
    const tags = [
      ...Array.from({ length: 6 }, (_, i) => ({
        url: `u${i}`,
        host: "h",
        label: `l${i}`,
        kind: "agent" as const,
      })),
      { url: "f", host: "h", label: "a.ts", kind: "file" as const },
    ];
    expect(buildUserRowView(msg({ text: "hi", elementTags: tags })).needsToggle).toBe(false);
  });

  it("tolerates a message with no tags", () => {
    expect(buildUserRowView(msg({})).tags).toEqual([]);
  });
});