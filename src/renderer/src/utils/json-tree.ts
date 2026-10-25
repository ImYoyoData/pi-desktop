/**
 * JSON 树 —— generic 工具结果（structuredContent / content 里的 JSON 文本）的结构化视图。
 */

export type JsonValueType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "array";

export type JsonTreeNode = {
  id: string;
  key: string | null;
  type: JsonValueType;
  /** 层级深度：根为 0。 */
  depth: number;
  /** 容器节点的子节点；标量节点为 null。 */
  children: JsonTreeNode[] | null;
  /** 标量节点的原始值。 */
  value: string | number | boolean | null;
  /** 节点数超上限，子节点被截断。 */
  truncated?: boolean;
};

/**
 * 节点上限：超大工具结果直接展开成几千个 DOM 行会拖垮渲染，
 * 超限后停止下钻并标记 truncated。
 */
export const JSON_TREE_MAX_NODES = 2000;

/**
 * 深度上限：JSON.parse 能造出上万层嵌套，递归建树再加递归渲染会直接爆栈。
 * 超限的容器保留节点但不再下钻。
 */
export const JSON_TREE_MAX_DEPTH = 32;

export function jsonValueType(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return "object";
}

function buildNode(
  value: unknown,
  key: string | null,
  depth: number,
  path: string,
  budget: { count: number },
): JsonTreeNode {
  const type = jsonValueType(value);
  const id = path;
  budget.count += 1;
  if (type === "object" || type === "array") {
    if (depth >= JSON_TREE_MAX_DEPTH) {
      return { id, key, type, depth, children: [], value: null, truncated: true };
    }
    const entries: Array<[string, unknown]> =
      type === "array"
        ? (value as unknown[]).map((item, index) => [String(index), item])
        : Object.entries(value as Record<string, unknown>);
    const children: JsonTreeNode[] = [];
    let truncated = false;
    for (let index = 0; index < entries.length; index++) {
      if (budget.count >= JSON_TREE_MAX_NODES) {
        truncated = true;
        break;
      }
      const [childKey, childValue] = entries[index]!;
      children.push(
        buildNode(childValue, childKey, depth + 1, `${path}/${index}`, budget),
      );
    }
    return { id, key, type, depth, children, value: null, truncated };
  }
  return { id, key, type, depth, children: null, value: value as string | number | boolean | null };
}

/**
 * 构建一棵 JSON 树。根节点没有 key。
 *
 * 节点 id 来自树里的路径（root/0/2），不是全局计数器：
 * 计数器每次重建都会变，折叠状态就再也对不上。
 */
export function buildJsonTree(value: unknown): JsonTreeNode {
  return buildNode(value, null, 0, "root", { count: 0 });
}

/** 默认收起深度过深的容器，避免大结果一打开就是几千行。 */
export function defaultClosedNodeIds(tree: JsonTreeNode, maxOpenDepth = 2): Set<string> {
  const out = new Set<string>();
  const walk = (node: JsonTreeNode): void => {
    if (!node.children?.length) return;
    if (node.depth >= maxOpenDepth) out.add(node.id);
    node.children.forEach(walk);
  };
  walk(tree);
  return out;
}

/**
 * 从文本里解析 JSON：工具结果常把 JSON 包在 ```json 围栏里，直接 parse 会失败。
 * 解析不出来返回 null，调用方据此退回纯文本。
 */
export function parseJsonPayload(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
