import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Modal } from "antd";
import DOMPurify from "dompurify";
import MarkdownRender, { type CodeBlockPreviewPayload } from "markstream-react";
import "markstream-react/index.css";
import { markdownRootClassName } from "@renderer/utils/markdown";
import type { MarkdownAssetBase } from "@renderer/utils/markdown-assets";
import { handleAppLinkClick, type LinkConfirmDialog } from "@renderer/utils/open-link";
import {
  MARKDOWN_CUSTOM_ID,
  MARKDOWN_HTML_COMPONENTS,
  MARKDOWN_HTML_ID,
  MarkdownAssetsProvider,
} from "./markdown/custom-nodes";
import { MARKDOWN_HTML_PARSE_OPTIONS, MARKDOWN_PARSE_OPTIONS } from "./markdown/html-policy";
import { applyMarkstreamMessages } from "./markdown/markstream-i18n";
import { t as currentMessages } from "@renderer/i18n";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useStreamRenderStore } from "@renderer/stores/stream-render";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useDialog } from "@renderer/services/feedback";
import styles from "./MarkdownView.module.css";

/**
 * 壁纸模式下代码块要整块透出壁纸：markstream 把底色内联在容器上，@pierre/diffs 又把正文
 * 描在 shadow root 里，样式选择器够不到，只能在渲染后清掉实际生效的底色与分隔线。
 * 回调内同步处理，不排到下一帧，否则流式生成时会先闪一帧实色。
 */
function useGlassCodeBackground(
  rootRef: RefObject<HTMLDivElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;

    const handled = new WeakSet<Element>();
    const watched = new WeakSet<Node>();
    const observers: MutationObserver[] = [];

    /** 只在普通代码块内动手；diff 块的增删行底色要保留。 */
    const insidePlainCodeBlock = (el: Element): boolean => {
      let node: Element | null = el;
      while (node) {
        if (node.classList.contains("is-diff")) return false;
        if (node.classList.contains("code-block-container")) return true;
        const rootNode = node.getRootNode();
        node = node.parentElement ?? (rootNode instanceof ShadowRoot ? rootNode.host : null);
      }
      return false;
    };

    const clearElement = (el: HTMLElement, force = false): void => {
      if (!force && handled.has(el)) return;
      handled.add(el);
      const style = getComputedStyle(el);
      if (style.backgroundColor !== "rgba(0, 0, 0, 0)") {
        el.style.setProperty("background-color", "transparent", "important");
      }
      if (!(el.getRootNode() instanceof ShadowRoot)) return;
      if (parseFloat(style.borderLeftWidth) > 0 && style.borderLeftColor !== "rgba(0, 0, 0, 0)") {
        el.style.setProperty("border-left-color", "transparent", "important");
      }
      if (parseFloat(style.borderRightWidth) > 0 && style.borderRightColor !== "rgba(0, 0, 0, 0)") {
        el.style.setProperty("border-right-color", "transparent", "important");
      }
    };

    const clearNode = (node: Element): void => {
      if (node instanceof HTMLElement) clearElement(node);
      for (const el of node.querySelectorAll<HTMLElement>("*")) clearElement(el);
      for (const host of [node, ...node.querySelectorAll<Element>("*")]) {
        const shadow = (host as HTMLElement).shadowRoot;
        if (!shadow) continue;
        watch(shadow);
        for (const el of shadow.querySelectorAll<HTMLElement>("*")) clearElement(el);
      }
    };

    function handle(records: MutationRecord[]): void {
      for (const record of records) {
        if (record.type === "attributes") {
          const target = record.target;
          if (target instanceof HTMLElement && insidePlainCodeBlock(target)) {
            clearElement(target, true);
          }
          continue;
        }
        for (const node of Array.from(record.addedNodes)) {
          if (node instanceof Element && insidePlainCodeBlock(node)) clearNode(node);
        }
      }
    }

    function watch(node: Node): void {
      if (watched.has(node)) return;
      watched.add(node);
      const observer = new MutationObserver(handle);
      observer.observe(node, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      observers.push(observer);
    }

    watch(root);
    for (const box of root.querySelectorAll<HTMLElement>(".code-block-container:not(.is-diff)")) {
      clearNode(box);
    }

    return () => {
      observers.forEach((observer) => observer.disconnect());
      const restore = (el: HTMLElement): void => {
        for (const prop of ["background-color", "border-left-color", "border-right-color"]) {
          if (el.style.getPropertyValue(prop) === "transparent") el.style.removeProperty(prop);
        }
      };
      for (const el of root.querySelectorAll<HTMLElement>("*")) {
        restore(el);
        if (el.shadowRoot) el.shadowRoot.querySelectorAll<HTMLElement>("*").forEach(restore);
      }
    };
  }, [rootRef, active]);
}

type Props = {
  content: string;
  /** "chat" applies the Copilot (VS Code) chat markdown look to the model output area. */
  variant?: "default" | "chat";
  /** 流式气泡：内容仍在增长，渲染器保持 loading 语义。 */
  streaming?: boolean;
  className?: string;
  /** 相对路径图片的解析基准（markdown 所在目录）；缺省按工作区根目录解析。 */
  assets?: MarkdownAssetBase | null;
  /** 单次解析的字符上限；文件预览传大值，避免长 JSON 退化成纯文本。 */
  maxChars?: number;
  /** 解析 HTML 里的 <img>（文件预览需要，流式消息不传）。 */
  htmlImages?: boolean;
};

/** 流式期间单次解析上限：超限按纯文本跟随，避免整段解析冻结界面。 */
const STREAM_MARKDOWN_MAX_CHARS = 24_000;
/** 已完成消息的解析上限：极端长回答直接纯文本，保证界面可用。 */
const MESSAGE_MARKDOWN_MAX_CHARS = 120_000;

const MERMAID_PROPS = {
  isStrict: false,
  enableMermaidInteractions: true,
  showModeToggle: false,
  showCollapseButton: false,
} as const;

applyMarkstreamMessages(currentMessages);

function MarkdownViewView({
  content,
  variant,
  streaming,
  className,
  assets: assetsProp,
  maxChars,
  htmlImages,
}: Props): ReactNode {
  const dialog = useDialog();
  const t = useI18n();
  const appearance = useAppearanceStore();
  const streamRender = useStreamRenderStore();
  const workspaceRoot = useWorkspaceStore((s) => s.root);

  const propDir = assetsProp?.dir ?? null;
  const propRoot = assetsProp?.root ?? null;
  /** 图片解析基准：优先用调用方给的文档目录，否则按工作区根目录。 */
  const assets = useMemo<MarkdownAssetBase | null>(() => {
    if (propDir) return { dir: propDir, root: propRoot };
    if (!workspaceRoot) return null;
    return { dir: workspaceRoot, root: workspaceRoot };
  }, [propDir, propRoot, workspaceRoot]);

  useEffect(() => {
    applyMarkstreamMessages(t);
  }, [t]);

  useEffect(() => {
    void streamRender.load();
  }, [streamRender]);

  const [artifact, setArtifact] = useState<{
    type: string;
    title: string;
    code: string;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useGlassCodeBackground(rootRef, appearance.glassSurface);

  /** 代码块里的 HTML/SVG 预览走项目自己的弹窗，脚本一律不执行。 */
  const onArtifactClick = useCallback((payload: CodeBlockPreviewPayload): void => {
    setArtifact({
      type: payload.artifactType,
      title: payload.artifactTitle,
      code: String(payload.node?.code ?? ""),
    });
  }, []);

  const linkDialog = useMemo<LinkConfirmDialog>(
    () => ({
      warning: (options) => {
        dialog.warning(options);
      },
    }),
    [dialog],
  );

  const onRootClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a") as HTMLAnchorElement | null;
      if (!anchor || !anchor.href) return;
      event.preventDefault();
      handleAppLinkClick(event.nativeEvent, anchor.href, linkDialog);
    },
    [linkDialog],
  );

  const tooLong =
    content.length >
    (maxChars ?? (streaming ? STREAM_MARKDOWN_MAX_CHARS : MESSAGE_MARKDOWN_MAX_CHARS));

  return (
    <div ref={rootRef} className={markdownRootClassName(variant, styles.root, className)}>
      {tooLong ? (
        <pre className="md-plain-block">{content}</pre>
      ) : (
        <MarkdownAssetsProvider assets={assets}>
          <MarkdownRender
            customId={htmlImages ? MARKDOWN_HTML_ID : MARKDOWN_CUSTOM_ID}
            streamingComponents={htmlImages ? MARKDOWN_HTML_COMPONENTS : undefined}
            content={content}
            final={!streaming}
            isDark={appearance.resolvedTheme === "dark"}
            fade={false}
            smoothStreaming={false}
            deferNodesUntilVisible={false}
            viewportPriority
            parseOptions={htmlImages ? MARKDOWN_HTML_PARSE_OPTIONS : MARKDOWN_PARSE_OPTIONS}
            htmlPolicy="trusted"
            showTooltips={false}
            mermaidProps={MERMAID_PROPS}
            onHandleArtifactClick={onArtifactClick}
            onClick={onRootClick}
          />
        </MarkdownAssetsProvider>
      )}

      <Modal
        open={artifact !== null}
        title={artifact?.title}
        footer={null}
        width="min(100vw - 16px, 1200px)"
        onCancel={() => setArtifact(null)}
      >
        {artifact?.type === "image/svg+xml" ? (
          <div
            className={styles.artifactViewport}
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(artifact.code, {
                USE_PROFILES: { svg: true, svgFilters: true },
              }),
            }}
          />
        ) : (
          <iframe
            className={styles.artifactFrame}
            sandbox=""
            title={artifact?.title}
            srcDoc={artifact?.code ?? ""}
          />
        )}
      </Modal>
    </div>
  );
}

/** 父级频繁重渲染（流式、滚动测量）时，正文内容没变就不必再进渲染器。 */
export const MarkdownView = memo(MarkdownViewView);

export default MarkdownView;
