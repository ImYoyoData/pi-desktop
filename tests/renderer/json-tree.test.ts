import { describe, expect, it } from "vitest";
import {
  buildJsonTree,
  defaultClosedNodeIds,
  JSON_TREE_MAX_DEPTH,
  jsonValueType,
  parseJsonPayload,
  type JsonTreeNode,
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

  it("derives ids from the tree path so a rebuild keeps them", () => {
    const ids = (node: JsonTreeNode): string[] => [
      node.id,
      ...(node.children ?? []).flatMap(ids),
    ];
    expect(ids(buildJsonTree({ a: [{ b: 1 }] }))).toEqual(
      ids(buildJsonTree({ a: [{ b: 1 }] })),
    );
  });

  it("stops descending at the depth limit instead of overflowing the stack", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 5000; i++) deep = [deep];
    const tree = buildJsonTree(deep);
    let node = tree;
    while (node.children?.length) node = node.children[0]!;
    expect(node.depth).toBe(JSON_TREE_MAX_DEPTH);
    expect(node.truncated).toBe(true);
    expect(node.children).toEqual([]);
  });
});

describe("defaultClosedNodeIds", () => {
  it("closes containers at or below the open depth", () => {
    const tree = buildJsonTree({ a: { b: { c: 1 } } });
    const closed = defaultClosedNodeIds(tree, 2);
    expect(closed.has("root")).toBe(false);
    expect(closed.has("root/0")).toBe(false);
    expect(closed.has("root/0/0")).toBe(true);
  });

  it("never closes scalar leaves", () => {
    const tree = buildJsonTree({ a: 1 });
    expect(defaultClosedNodeIds(tree, 0).has("root/0")).toBe(false);
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
