import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type Key,
  type ReactNode,
} from "react";
import {
  CodeBlockNode as StreamCodeBlockNode,
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

/** 普通代码块沿用旧实现的 420px 最高高度，超出在块内滚动。 */
const CODE_OPTIONS = {
  maxHeight: 420,
  overflow: "scroll",
  tabSize: 2,
} as const;

/**
 * diff 块交给 markstream 内置的代码块（stream-diffs）：unified 单列更贴合聊天气泡，
 * 行内 word 级差异保留，未改动行不折叠。
 */
const DIFF_CODE_OPTIONS = {
  diffStyle: "unified",
  diffIndicators: "classic",
  hunkSeparators: "line-info",
  lineDiffType: "word-alt",
  expandUnchanged: true,
  overflow: "scroll",
} as const;

type CodeBlockProps = {
  node: FenceNode;
  isDark?: boolean;
};

function fenceLanguage(node: FenceNode): string {
  return (node.language ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * 代码块进视口附近才真正挂载：shiki 高亮是同步重活，切换会话时几十个代码块
 * 一起初始化会把主线程占满。占位高度按行数估，600px 预渲染基本看不到占位。
 */
function useNearViewport(): { ref: (el: HTMLDivElement | null) => void; visible: boolean } {
  const host = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  return {
    ref: (el) => {
      host.current = el;
    },
    visible,
  };
}

function placeholderHeight(code: string): number {
  if (!code) return 64;
  const lines = code.replace(/\n$/, "").split("\n").length;
  return Math.min(420, 36 + Math.min(lines, 18) * 20);
}

/** 代码块：交给 markstream 内置渲染（shiki 高亮、长代码折叠、字号与换行切换、diff 视图）。 */
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

  const { ref, visible } = useNearViewport();

  if (!visible) {
    return (
      <div
        ref={ref}
        className="md-code-placeholder"
        style={{ height: `${placeholderHeight(code)}px` }}
      />
    );
  }

  return (
    <StreamCodeBlockNode
      node={
        { ...node, code, type: "code_block" } as ComponentProps<
          typeof StreamCodeBlockNode
        >["node"]
      }
      isDark={isDark}
      loading={Boolean(node.loading)}
      showLineNumbers
      showTooltips={false}
      codeBlockOptions={node.diff ? DIFF_CODE_OPTIONS : CODE_OPTIONS}
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
 * 会把它折叠成空格。旧渲染器用 breaks:true 直接输出 <br>，这里保持一致。
 */
function MarkdownTextNode({ node }: TextNodeProps): ReactNode {
  const content = node.content ?? "";
  if (!content.includes("\n")) return content;
  const lines = content.split("\n");
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
