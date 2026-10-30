import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type Key,
  type ReactNode,
} from "react";
import {
  CodeBlockNode as MarkstreamCodeBlockNode,
  MermaidBlockNode,
  setCustomComponents,
} from "markstream-react";
import {
  resolveMarkdownImageSrc,
  type MarkdownAssetBase,
} from "@renderer/utils/markdown-assets";
import { DotDiagramNode } from "./DotDiagramNode";

export const MARKDOWN_CUSTOM_ID = "pi-markdown";

const AssetsContext = createContext<MarkdownAssetBase | null>(null);

export function MarkdownAssetsProvider({
  assets,
  children,
}: {
  assets: MarkdownAssetBase | null;
  children: ReactNode;
}): ReactNode {
  return <AssetsContext.Provider value={assets}>{children}</AssetsContext.Provider>;
}

/** Fence langs that should render via Mermaid (not highlight.js). */
const MERMAID_LANGS = new Set([
  "mermaid",
  "flowchart",
  "sequence",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "statediagram-v2",
  "erdiagram",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitgraph",
  "journey",
  "quadrantchart",
  "xychart-beta",
  "sankey-beta",
  "requirementdiagram",
  "architecture-beta",
]);

/** Detect untitled fences that are clearly Mermaid diagrams. */
function looksLikeMermaidSource(source: string): boolean {
  const head = source.trimStart();
  return /^(flowchart|graph\s+(TD|TB|BT|RL|LR)|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|gitGraph|journey)\b/m.test(
    head,
  );
}

type FenceNode = {
  type?: string;
  code?: string;
  language?: string;
  loading?: boolean;
  diff?: boolean;
  originalCode?: string;
  updatedCode?: string;
  raw?: string;
};

type CodeBlockProps = {
  node: FenceNode;
  isDark?: boolean;
};

function fenceLanguage(node: FenceNode): string {
  return (node.language ?? "").trim().split(/\s+/)[0] ?? "";
}

/** 代码块与 ```diff 都交给 markstream 的代码块（stream-diffs 高亮），只有图表自己渲染。 */
function CodeBlockNode({ node, isDark }: CodeBlockProps): ReactNode {
  const code = node.code ?? "";
  const language = fenceLanguage(node);
  const langKey = language.toLowerCase();

  if (MERMAID_LANGS.has(langKey) || (!langKey && looksLikeMermaidSource(code))) {
    return (
      <MermaidBlockNode
        node={
          { ...node, code, type: "code_block" } as ComponentProps<
            typeof MermaidBlockNode
          >["node"]
        }
        isDark={isDark}
        loading={Boolean(node.loading)}
        isStrict={false}
        enableMermaidInteractions
        showModeToggle={false}
      />
    );
  }

  return (
    <MarkstreamCodeBlockNode
      node={
        { ...node, type: "code_block", code, language } as ComponentProps<
          typeof MarkstreamCodeBlockNode
        >["node"]
      }
      isDark={isDark}
      loading={Boolean(node.loading)}
      showLineNumbers
      showExpandButton={false}
      enableFontSizeControl={false}
      showCollapseButton={false}
      showFontSizeButtons={false}
    />
  );
}

/** ```math / ```latex 围栏：display 模式公式。katex 体积大，按需加载，未就绪时先显示原文。 */
function MathFenceNode({ node }: { node: FenceNode }): ReactNode {
  const source = (node.code ?? "").trim();
  const [html, setHtml] = useState("");

  useEffect(() => {
    if (!source) return;
    let alive = true;
    void import("katex").then(({ default: katex }) => {
      if (!alive) return;
      try {
        setHtml(
          katex.renderToString(source, {
            displayMode: true,
            throwOnError: false,
            strict: "ignore",
          }),
        );
      } catch {
        setHtml("");
      }
    });
    return () => {
      alive = false;
    };
  }, [source]);

  if (!html) return <pre className="md-math-fallback">{source}</pre>;
  return <div className="md-math-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

type TextNodeProps = {
  node: { content?: string };
};

/**
 * 文本节点：解析器把软换行留在同一段文本里（content 里带换行符），而浏览器
 * 会把它折叠成空格；旧渲染器用 breaks:true 输出 <br>，这里保持一致。
 *
 * 首尾的换行是块结构自己的边界（段落、列表项），转成 <br> 会多出空行，
 * 所以先裁掉再处理行内的软换行。
 */
function MarkdownTextNode({ node }: TextNodeProps): ReactNode {
  const content = node.content ?? "";
  const trimmed = content.replace(/^\n+/, "").replace(/\n+$/, "");
  if (!trimmed.includes("\n")) return trimmed;
  const lines = trimmed.split("\n");
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br /> : null}
          {line}
        </Fragment>
      ))}
    </>
  );
}

type ImageNodeProps = {
  node: { src?: string; alt?: string; title?: string | null };
};

/** 只放行可安全加载的图片协议，模型输出里的 javascript:/vbscript: 一律丢掉。 */
const SAFE_IMAGE_SCHEME_RE = /^(?:https?|data:image\/|blob:|pi-local:|pi-media:)/i;
const HAS_SCHEME_RE = /^[a-zA-Z][\w+.-]*:/;

function safeImageSrc(raw: string, resolved: string | null): string {
  const src = resolved ?? raw;
  if (!HAS_SCHEME_RE.test(src)) return src;
  return SAFE_IMAGE_SCHEME_RE.test(src) ? src : "";
}

/** 图片：相对路径按当前文档目录解析成 pi-local 地址。 */
function MarkdownImageNode({ node }: ImageNodeProps): ReactNode {
  const assets = useContext(AssetsContext);
  const raw = (node.src ?? "").trim();
  const src = safeImageSrc(raw, resolveMarkdownImageSrc(raw, assets));
  return (
    <img
      src={src}
      alt={node.alt ?? ""}
      title={node.title ?? undefined}
      loading="lazy"
    />
  );
}

type LinkNodeProps = {
  node: {
    href?: string;
    title?: string | null;
    text?: string;
    children?: unknown[];
  };
  ctx?: unknown;
  indexKey?: Key;
  renderNode?: (node: unknown, key: Key, ctx: unknown) => ReactNode;
};

/** 链接：普通 <a>，点击由外层事件委托接管（应用内打开 / 外部确认）。 */
function MarkdownLinkNode({
  node,
  ctx,
  indexKey,
  renderNode,
}: LinkNodeProps): ReactNode {
  const href = node.href ?? "";
  const children = Array.isArray(node.children) ? node.children : [];
  const label =
    renderNode && children.length
      ? children.map((child, index) => renderNode(child, `${indexKey}-l${index}`, ctx))
      : node.text;
  return (
    <a href={href} title={node.title ?? undefined} rel="noopener noreferrer">
      {label}
    </a>
  );
}

setCustomComponents({
  text: MarkdownTextNode,
  code_block: CodeBlockNode,
  image: MarkdownImageNode,
  link: MarkdownLinkNode,
  dot: DotDiagramNode,
  gv: DotDiagramNode,
  koxgxsih: DotDiagramNode,
  math: MathFenceNode,
  latex: MathFenceNode,
  tex: MathFenceNode,
  katex: MathFenceNode,
});
