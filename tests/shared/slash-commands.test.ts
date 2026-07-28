import { describe, expect, it } from "vitest";
import {
  filterSlashItems,
  parseSlashContext,
  replaceSlashLine,
  skillSlashCommand,
  type SlashItem,
} from "../../src/shared/slash-commands";

const items: SlashItem[] = [
  {
    id: "compact",
    kind: "builtin",
    command: "compact",
    title: "/compact",
    description: "Compact context",
  },
  {
    id: "skill:browser",
    kind: "skill",
    command: "skill:browser",
    title: "/skill:browser",
    description: "Browse the web",
  },
];

describe("parseSlashContext", () => {
  it("detects slash on last line", () => {
    expect(parseSlashContext("/com")).toEqual({
      query: "com",
      slashIndex: 0,
      line: "/com",
    });
    expect(parseSlashContext("hello\n/skill:b")).toEqual({
      query: "skill:b",
      slashIndex: 6,
      line: "/skill:b",
    });
  });

  it("closes once args begin", () => {
    expect(parseSlashContext("/skill:browser do stuff")).toBeNull();
    expect(parseSlashContext("plain text")).toBeNull();
  });
});

describe("filterSlashItems", () => {
  it("filters by command or description", () => {
    expect(filterSlashItems(items, "comp").map((i) => i.id)).toEqual(["compact"]);
    expect(filterSlashItems(items, "web").map((i) => i.id)).toEqual(["skill:browser"]);
  });
});

describe("replaceSlashLine", () => {
  it("rewrites the active slash line", () => {
    const draft = "note\n/sk";
    const ctx = parseSlashContext(draft)!;
    expect(replaceSlashLine(draft, ctx, skillSlashCommand("browser"), true)).toBe(
      "note\n/skill:browser ",
    );
  });
});
