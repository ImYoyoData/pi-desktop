import { useMemo, useState, type ReactNode } from "react";
import { defaultClosedNodeIds, buildJsonTree, type JsonTreeNode } from "@renderer/utils/json-tree";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ToolBody.module.css";

function jsonScalarClass(type: string): string {
  if (type === "string") return styles.jsonStr;
  if (type === "number") return styles.jsonNum;
  if (type === "boolean") return styles.jsonBool;
  return styles.jsonNull;
}

function jsonScalarText(value: string | number | boolean | null, type: string): string {
  if (type === "string") {
    const text = String(value);
    return `"${text.length > 120 ? `${text.slice(0, 119)}…` : text}"`;
  }
  return String(value);
}

function JsonNodeRow({
  node,
  closed,
  onToggle,
  guide,
  isLast,
}: {
  node: JsonTreeNode;
  closed: Set<string>;
  onToggle: (id: string) => void;
  guide: string;
  isLast: boolean;
}): ReactNode {
  const t = useI18n();
  const isContainer = node.children != null;
  const open = isContainer && !closed.has(node.id);
  const rowGuide = guide + (isLast ? "└─ " : "├─ ");
  const childGuide = guide + (isLast ? "   " : "│  ");

  if (!isContainer) {
    return (
      <div className={styles.jsonRow}>
        <span className={styles.jsonChev} />
        <span className={styles.jsonGuide}>{rowGuide}</span>
        {node.key !== null ? <span className={styles.jsonKey}>{node.key}</span> : null}
        <span className={styles.jsonPunct}>: </span>
        <span className={`${jsonScalarClass(node.type)} ${styles.jsonValue}`}>
          {jsonScalarText(node.value, node.type)}
        </span>
      </div>
    );
  }

  const label =
    node.type === "array" ? `[${node.children?.length ?? 0}]` : `{${node.children?.length ?? 0}}`;
  return (
    <>
      <button
        type="button"
        className={`${styles.jsonRow} ${open ? styles.jsonOpen : ""}`}
        aria-expanded={open}
        onClick={() => onToggle(node.id)}
      >
        <span className={styles.jsonChev}>›</span>
        <span className={styles.jsonGuide}>{rowGuide}</span>
        {node.key !== null ? <span className={styles.jsonKey}>{node.key}</span> : null}
        <span className={styles.jsonPunct}>: </span>
        <span className={styles.jsonType}>{label}</span>
        {node.truncated ? (
          <span className={styles.jsonTruncated}>{t.toolBodyJsonTruncated}</span>
        ) : null}
      </button>
      {open && node.children?.length
        ? node.children.map((child, index) => (
            <JsonNodeRow
              key={child.id}
              node={child}
              closed={closed}
              onToggle={onToggle}
              guide={childGuide}
              isLast={index === node.children!.length - 1}
            />
          ))
        : null}
    </>
  );
}

export function JsonTree({ tree }: { tree: JsonTreeNode }): ReactNode {
  const [closed, setClosed] = useState<Set<string>>(() => defaultClosedNodeIds(tree));

  function toggle(id: string): void {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={styles.jsonTree}>
      <JsonNodeRow node={tree} closed={closed} onToggle={toggle} guide="" isLast />
    </div>
  );
}

/** JSON 树：generic 结果、MCP/浏览器详情与嵌套调用参数共用。 */
export function ToolJsonTree({ value }: { value: unknown }): ReactNode {
  const tree = useMemo(() => {
    if (value == null || typeof value !== "object") return null;
    return buildJsonTree(value);
  }, [value]);
  if (tree) return <JsonTree tree={tree} />;
  if (value == null) return null;
  return (
    <pre className={styles.plain}>
      {typeof value === "string" ? value : String(value)}
    </pre>
  );
}

export default ToolJsonTree;
