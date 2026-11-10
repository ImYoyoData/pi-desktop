import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type Key,
  type ReactNode,
} from "react";
import { Image } from "antd";
import {
  CodeBlockNode as MarkstreamCodeBlockNode,
  MermaidBlockNode,
  PreCodeNode,
  languageMap,
  normalizeLanguageIdentifier,
  resolveLanguageId,
  setCustomComponents,
} from "markstream-react";
import {
  resolveMarkdownImageSrc,
  type MarkdownAssetBase,
} from "@renderer/utils/markdown-assets";
import { useAppearanceStore } from "@renderer/stores/appearance";
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

type CodeBlockProps = Omit<
  ComponentProps<typeof MarkstreamCodeBlockNode>,
  "node"
> & {
  node: FenceNode;
};

function fenceLanguage(node: FenceNode): string {
  return (node.language ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * 代码块正文由 @pierre/diffs 渲染在 shadow root 里，:host 用 --diffs-bg 画底色，
 * 外部选择器选不到内部元素，只能通过它渲染时注入的 unsafeCSS 改。
 * 壁纸模式下与消息区一致：不留下底色，透出壁纸。
 */
const GLASS_CODE_CSS =
  ":host{--diffs-light-bg:transparent;--diffs-dark-bg:transparent}" +
  "pre,code,[data-gutter],[data-content]{background-color:transparent!important}";

/** diff 只清掉 :host 的深色壳：改动行的底色是 diff 的语义信息，不能一并抹掉。 */
const GLASS_DIFF_CSS = ":host{--diffs-light-bg:transparent;--diffs-dark-bg:transparent}";

/** 与 markstream 最终代码块的默认高度上限一致，避免闭合时高度回退。 */
const STREAM_CODE_MAX_HEIGHT = 500;

/** 代码块闭合时才去加载 diffs / shiki 会卡住整条消息，围栏一出现就预热主题与语法。 */
function preloadHighlight(language: string, isDark?: boolean): void {
  const lang = resolveLanguageId(normalizeLanguageIdentifier(language));
  if (!lang || lang === "text" || lang === "plaintext") return;
  void import("@pierre/diffs")
    .then(({ getSharedHighlighter }) =>
      getSharedHighlighter({
        themes: [isDark ? "vitesse-dark" : "vitesse-light"],
        langs: [lang],
      }),
    )
    .catch(() => {
      // 预热失败不影响最终渲染
    });
}

/**
 * 围栏未闭合时的预览。markstream 内置的骨架屏会遮住正文直到围栏闭合，
 * 这里直接跟随纯文本，既没有骨架闪烁，也不会提前触发 shiki 高亮。
 */
function StreamingFence({
  node,
  code,
  language,
  isDark,
  maxHeight,
}: {
  node: FenceNode;
  code: string;
  language: string;
  isDark?: boolean;
  maxHeight: number;
}): ReactNode {
  useEffect(() => {
    preloadHighlight(language, isDark);
  }, [isDark, language]);

  const lang = resolveLanguageId(normalizeLanguageIdentifier(language));
  const label = languageMap[lang] || (lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : "Plain Text");

  return (
    <div
      className={`code-block-container my-4 rounded-lg border overflow-hidden shadow-sm${isDark ? " is-dark" : ""}`}
      style={{
        color: "var(--vscode-editor-foreground, var(--markstream-code-fallback-fg, var(--code-fg)))",
        backgroundColor: "var(--vscode-editor-background, var(--markstream-code-fallback-bg, var(--code-bg)))",
        borderColor: "var(--markstream-code-border-color, var(--code-border))",
      }}
    >
      <div className="code-block-header">
        <div className="code-header-main">
          <span className="icon-slot h-4 w-4 flex-shrink-0" />
          <div className="code-header-copy min-w-0">
            <div className="code-header-title truncate">
              {label}
            </div>
          </div>
        </div>
      </div>
      <div className="code-block-body">
        <PreCodeNode
          className="code-fallback-plain m-0"
          node={
            { ...node, type: "code_block", code, language } as ComponentProps<
              typeof PreCodeNode
            >["node"]
          }
          showLineNumbers={!node.diff}
          style={{ maxHeight, overflow: "auto" }}
        />
      </div>
    </div>
  );
}

/** 代码块与 ```diff 都交给 markstream 的代码块（stream-diffs 高亮），只有图表自己渲染。 */
function CodeBlockNode({
  node,
  isDark,
  codeBlockOptions,
  ...codeProps
}: CodeBlockProps): ReactNode {
  // markstream 把 code 原样交给渲染器，fence 末尾的换行会多出一行空行（行号也多一个）。
  const code = node.diff ? (node.code ?? "") : (node.code ?? "").replace(/\r\n$|\n$|\r$/, "");
  const language = fenceLanguage(node);
  const langKey = language.toLowerCase();
  const glassSurface = useAppearanceStore((state) => state.glassSurface);
  const mergedOptions = useMemo(() => {
    if (!glassSurface && !codeBlockOptions) return undefined;
    const unsafeCSS = [
      codeBlockOptions?.unsafeCSS,
      glassSurface ? (node.diff ? GLASS_DIFF_CSS : GLASS_CODE_CSS) : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { ...codeBlockOptions, ...(unsafeCSS ? { unsafeCSS } : {}) };
  }, [codeBlockOptions, glassSurface, node.diff]);

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

  if (node.loading) {
    const previewCode = node.diff
      ? (node.raw ?? code).replace(/\r\n$|\n$|\r$/, "")
      : code;
    return (
      <StreamingFence
        node={node}
        code={previewCode}
        language={language}
        isDark={isDark}
        maxHeight={
          typeof mergedOptions?.maxHeight === "number"
            ? mergedOptions.maxHeight
            : STREAM_CODE_MAX_HEIGHT
        }
      />
    );
  }

  return (
    <MarkstreamCodeBlockNode
      showLineNumbers
      showExpandButton={false}
      enableFontSizeControl={false}
      showCollapseButton={false}
      showFontSizeButtons={false}
      {...codeProps}
      node={
        { ...node, type: "code_block", code, language } as ComponentProps<
          typeof MarkstreamCodeBlockNode
        >["node"]
      }
      isDark={isDark}
      loading={Boolean(node.loading)}
      codeBlockOptions={mergedOptions}
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
    <Image
      src={src}
      alt={node.alt ?? ""}
      title={node.title ?? undefined}
      style={{ width: "auto", maxWidth: "100%" }}
      styles={{ root: { maxWidth: "100%" } }}
    />
  );
}

type HtmlImageNodeProps = {
  node: { attrs?: Array<[string, string | null]> };
};

/** HTML 尺寸属性是裸数字，转成 CSS 需要单位。 */
function attrSize(value: string | null | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  return /^\d+(?:\.\d+)?$/.test(raw) ? `${raw}px` : raw;
}

/**
 * html_block/html_inline 里的 <img>：markstream 的 HTML 清洗只放行 http(s)，
 * 本地图片会被连 src 一起丢掉，所以这里从原始属性重建。
 */
function HtmlImageNode({ node }: HtmlImageNodeProps): ReactNode {
  const assets = useContext(AssetsContext);
  const attrs = new Map(
    (node.attrs ?? []).map(([key, value]) => [key.toLowerCase(), value ?? ""]),
  );
  const raw = (attrs.get("src") ?? "").trim();
  const src = safeImageSrc(raw, resolveMarkdownImageSrc(raw, assets));
  const centered = (attrs.get("align") ?? "").toLowerCase() === "center";
  const width = attrSize(attrs.get("width"));
  const height = attrSize(attrs.get("height"));
  return (
    <Image
      src={src}
      alt={attrs.get("alt") ?? ""}
      title={attrs.get("title") || undefined}
      className={attrs.get("class") || undefined}
      style={{
        width: width ?? "auto",
        height: height ?? "auto",
        maxWidth: "100%",
        ...(centered ? { display: "block", margin: "0 auto" } : {}),
      }}
      styles={{ root: centered ? { display: "block", maxWidth: "100%" } : { maxWidth: "100%" } }}
    />
  );
}

/**
 * HTML 标签的 node 级映射：属性不经 markstream 清洗，直接交给组件。
 *
 * 只能给文件预览用：这些 key 会被 markstream 合并进 customHtmlTags，流式解析会把
 * 行内代码里的 <img> 也当成标签（消息区会直接渲染出一张巨大的图），所以聊天消息
 * 继续用 MARKDOWN_CUSTOM_ID 的原始行为。
 */
export const MARKDOWN_HTML_ID = "pi-markdown-html";
export const MARKDOWN_HTML_COMPONENTS = { img: HtmlImageNode };

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

setCustomComponents(MARKDOWN_HTML_ID, MARKDOWN_HTML_COMPONENTS);
