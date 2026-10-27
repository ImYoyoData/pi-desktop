import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Modal } from "antd";
import DOMPurify from "dompurify";
import MarkdownRender, { type CodeBlockPreviewPayload } from "markstream-react";
import "markstream-react/index.css";
import { markdownRootClassName } from "@renderer/utils/markdown";
import type { MarkdownAssetBase } from "@renderer/utils/markdown-assets";
import { handleAppLinkClick, type LinkConfirmDialog } from "@renderer/utils/open-link";
import { MARKDOWN_CUSTOM_ID, MarkdownAssetsProvider } from "./markdown/custom-nodes";
import { MARKDOWN_PARSE_OPTIONS } from "./markdown/html-policy";
import { applyMarkstreamMessages } from "./markdown/markstream-i18n";
import { t as currentMessages } from "@renderer/i18n";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useStreamRenderStore } from "@renderer/stores/stream-render";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useDialog } from "@renderer/services/feedback";
import styles from "./MarkdownView.module.css";

type Props = {
  content: string;
  /** "chat" applies the Copilot (VS Code) chat markdown look to the model output area. */
  variant?: "default" | "chat";
  /** 流式气泡：内容仍在增长，渲染器保持 loading 语义。 */
  streaming?: boolean;
  className?: string;
  /** 相对路径图片的解析基准（markdown 所在目录）；缺省按工作区根目录解析。 */
  assets?: MarkdownAssetBase | null;
};

/** 流式期间单次解析上限：超限按纯文本跟随，避免整段解析冻结界面。 */
const STREAM_MARKDOWN_MAX_CHARS = 24_000;
/** 已完成消息的解析上限：极端长回答直接纯文本，保证界面可用。 */
const MESSAGE_MARKDOWN_MAX_CHARS = 120_000;

/**
 * markstream 平滑器的基准参数：目标是「跟着模型输出走」，不是打字机回放。
 * 目标延迟压到 240ms、追赶阈值压到 240 字符，长回答也能在流结束后立刻收敛。
 */
const SMOOTH_BASE = {
  minCharsPerSecond: 200,
  maxCharsPerSecond: 2400,
  targetLatencyMs: 240,
  catchUpLatencyMs: 120,
  catchUpThreshold: 240,
  maxCharsPerCommit: 400,
  startDelayMs: 0,
  flushOnFinish: true,
} as const;

const MERMAID_PROPS = {
  isStrict: false,
  enableMermaidInteractions: true,
  showModeToggle: false,
  showCollapseButton: false,
} as const;

applyMarkstreamMessages(currentMessages);

export function MarkdownView({
  content,
  variant,
  streaming,
  className,
  assets: assetsProp,
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

  /** 刷新间隔在这里换算成提交帧率，0（不节流）按浏览器刷新率上限算。 */
  const smoothOptions = useMemo(
    () => ({
      ...SMOOTH_BASE,
      maxCommitFps:
        streamRender.throttleMs > 0 ? Math.round(1000 / streamRender.throttleMs) : 60,
    }),
    [streamRender.throttleMs],
  );

  const [artifact, setArtifact] = useState<{
    type: string;
    title: string;
    code: string;
  } | null>(null);

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
    (streaming ? STREAM_MARKDOWN_MAX_CHARS : MESSAGE_MARKDOWN_MAX_CHARS);

  return (
    <div className={markdownRootClassName(variant, styles.root, className)}>
      {tooLong ? (
        <pre className="md-plain-block">{content}</pre>
      ) : (
        <MarkdownAssetsProvider assets={assets}>
          <MarkdownRender
            customId={MARKDOWN_CUSTOM_ID}
            content={content}
            final={!streaming}
            isDark={appearance.resolvedTheme === "dark"}
            fade={false}
            smoothStreaming={streamRender.smooth ? "auto" : false}
            smoothStreamingOptions={smoothOptions}
            maxLiveNodes={0}
            batchRendering={false}
            deferNodesUntilVisible={false}
            viewportPriority
            parseOptions={MARKDOWN_PARSE_OPTIONS}
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

export default MarkdownView;
