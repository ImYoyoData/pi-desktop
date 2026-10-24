import { describe, expect, it } from "vitest";
import {
  buildJsonTree,
  jsonValueType,
  parseJsonPayload,
} from "../../src/renderer/src/utils/json-tree";

describe("jsonValueType", () => {
  it("detects scalar and container types", () => {
    expect(jsonValueType(null)).toBe("null");
    expect(jsonValueType(true)).toBe("boolean");
    expect(jsonValueType(1)).toBe("number");
    expect(jsonValueType("s")).toBe("string");
    expect(jsonValueType([])).toBe("array");
    expect(jsonValueType({})).toBe("object");
  });
});

describe("buildJsonTree", () => {
  it("nests objects and arrays with depth", () => {
    const tree = buildJsonTree({ a: { b: [1, "two"] } });
    expect(tree.type).toBe("object");
    expect(tree.depth).toBe(0);
    expect(tree.children?.[0]?.key).toBe("a");
    expect(tree.children?.[0]?.depth).toBe(1);
    expect(tree.children?.[0]?.children?.[0]?.key).toBe("b");
    expect(tree.children?.[0]?.children?.[0]?.children?.map((c) => c.value)).toEqual([
      1,
      "two",
    ]);
  });

  it("uses the array index as the key", () => {
    const tree = buildJsonTree(["x", "y"]);
    expect(tree.children?.map((child) => child.key)).toEqual(["0", "1"]);
  });

  it("gives every node a unique id", () => {
    const tree = buildJsonTree({ a: 1, b: { c: 2 } });
    const ids: string[] = [];
    const walk = (node: { id: string; children: typeof tree.children }): void => {
      ids.push(node.id);
      node.children?.forEach(walk);
    };
    walk(tree);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseJsonPayload", () => {
  it("parses raw JSON", () => {
    expect(parseJsonPayload('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(parseJsonPayload('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("returns null for plain text", () => {
    expect(parseJsonPayload("hello")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(parseJsonPayload("   ")).toBeNull();
  });
});
