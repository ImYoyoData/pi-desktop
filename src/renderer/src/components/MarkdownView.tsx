import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Modal, Space } from "antd";
import {
  createStreamBlockSplitter,
  renderMarkdown,
  renderMarkdownBlock,
  renderMarkdownCached,
  setMarkdownCopyLabel,
  type StreamBlockSplitter,
} from "@renderer/utils/markdown";
import {
  applyDiagramZoom,
  clampDiagramZoom,
  getDiagramSource,
  getDiagramSvgMarkup,
  handleDiagramToolClick,
  readDiagramZoom,
  type DiagramToolLabels,
} from "@renderer/utils/diagram-chrome";
import { mountDotIn } from "@renderer/utils/dot-render";
import { mountMermaidIn, resetMermaidForTheme } from "@renderer/utils/mermaid-render";
import { handleAppLinkClick, type LinkConfirmDialog } from "@renderer/utils/open-link";
import { MarkdownHtml } from "@renderer/utils/html-patch";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useStreamRenderStore } from "@renderer/stores/stream-render";
import { useI18n, useUiLocale } from "@renderer/i18n/use-i18n";
import { useDialog, useMessage } from "@renderer/services/feedback";
import styles from "./MarkdownView.module.css";
import "katex/dist/katex.min.css";

type Props = {
  content: string;
  /** "chat" applies the Copilot (VS Code) chat markdown look to the model output area. */
  variant?: "default" | "chat";
  /** Live stream bubble: growing content must not pollute the render cache. */
  streaming?: boolean;
  className?: string;
};

type RenderState = {
  blocks: string[];
  liveBlock: string;
  liveTail: string;
};

/** 已定型的 HTML 块：流式只追加新块，历史消息始终只有一整块。 */
const EMPTY_RENDER: RenderState = { blocks: [], liveBlock: "", liveTail: "" };

/** 旧渲染点之后的未完成尾部（未完成段落按纯文本跟随）。 */
const STREAM_TAIL_MAX_CHARS = 24_000;
/**
 * 流式期间单个未定型块的解析上限：模型正在写长代码块时，未闭合围栏会让整个块
 * 一直落在 live 块里，每个 tick 全量解析 + 高亮 + 净化会占满渲染线程，界面直接卡死。
 * 超限就按纯文本尾部跟随，块定型或流结束后再完整渲染。
 */
const STREAM_LIVE_BLOCK_MAX_CHARS = 12_000;
/** 旧渲染路径（流式渲染开关关闭）在流式期间的整段解析上限。 */
const STREAM_FULL_MAX_CHARS = 24_000;

function tailText(content: string, from: number): string {
  const tail = content.slice(from);
  return tail.length > STREAM_TAIL_MAX_CHARS
    ? `…${tail.slice(-STREAM_TAIL_MAX_CHARS)}`
    : tail;
}

/** 旧版的渲染点：最后一个空行之后（其前的内容全部渲染成 HTML）。 */
function renderPointOf(content: string): number {
  const at = content.lastIndexOf("\n\n");
  return at >= 0 ? at + 2 : 0;
}

export function MarkdownView({ content, variant, streaming, className }: Props): ReactNode {
  const t = useI18n();
  const locale = useUiLocale();
  const dialog = useDialog();
  const message = useMessage();
  const appearance = useAppearanceStore();

  /** 流式渲染设置：开关决定走增量分块还是旧版全量重解析。 */
  const streamRender = useStreamRenderStore();

  const rootEl = useRef<HTMLDivElement | null>(null);
  const previewViewportEl = useRef<HTMLDivElement | null>(null);

  const [renderState, setRenderState] = useState<RenderState>(EMPTY_RENDER);
  const renderStateRef = useRef<RenderState>(EMPTY_RENDER);
  const splitterRef = useRef<StreamBlockSplitter>(createStreamBlockSplitter());
  const liveBlockTextRef = useRef("");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewSvg, setPreviewSvg] = useState("");
  const [previewSource, setPreviewSource] = useState("");
  const [previewKind, setPreviewKind] = useState("diagram");

  const diagramTimer = useRef(0);
  const renderTimer = useRef(0);
  const pendingContent = useRef<string | null>(null);
  const lastRenderAt = useRef(0);

  const diagramLabels = useMemo<DiagramToolLabels>(
    () => ({
      zoomIn: t.mdDiagramZoomIn,
      zoomOut: t.mdDiagramZoomOut,
      zoomReset: t.mdDiagramZoomReset,
      expand: t.mdDiagramExpand,
      copySource: t.mdDiagramCopySource,
      downloadSvg: t.mdDiagramDownloadSvg,
    }),
    [t],
  );

  const linkDialog = useMemo<LinkConfirmDialog>(
    () => ({
      warning: (options) => {
        dialog.warning(options);
      },
    }),
    [dialog],
  );

  const applyRender = useCallback((next: RenderState): void => {
    renderStateRef.current = next;
    setRenderState(next);
  }, []);

  const refreshStream = useCallback(
    (source: string): void => {
      const splitter = splitterRef.current;
      const added = splitter.take(source);
      const blocks = renderStateRef.current.blocks.slice();
      if (added) {
        const block = renderMarkdownBlock(added);
        if (block) blocks.push(block);
      }
      const boundary = splitter.boundary;
      const renderPoint = Math.max(renderPointOf(source), boundary);
      const liveText = source.slice(boundary, renderPoint);
      if (liveText.length > STREAM_LIVE_BLOCK_MAX_CHARS) {
        liveBlockTextRef.current = "";
        applyRender({ blocks, liveBlock: "", liveTail: tailText(source, boundary) });
        return;
      }
      let liveBlock = renderStateRef.current.liveBlock;
      if (liveText !== liveBlockTextRef.current) {
        liveBlockTextRef.current = liveText;
        liveBlock = liveText ? renderMarkdown(liveText) : "";
      }
      applyRender({ blocks, liveBlock, liveTail: tailText(source, renderPoint) });
    },
    [applyRender],
  );

  const renderFull = useCallback(
    (source: string): void => {
      splitterRef.current = createStreamBlockSplitter();
      liveBlockTextRef.current = "";
      if (streaming && source.length > STREAM_FULL_MAX_CHARS) {
        applyRender({ blocks: [], liveBlock: "", liveTail: tailText(source, 0) });
        return;
      }
      // 流式期间的内容不会被复用，写入 LRU 只会淘汰历史消息的缓存。
      const render = streaming ? renderMarkdown : renderMarkdownCached;
      applyRender({
        blocks: source ? [render(source)] : [],
        liveBlock: "",
        liveTail: "",
      });
    },
    [applyRender, streaming],
  );

  const resetStreamState = useCallback((): void => {
    splitterRef.current = createStreamBlockSplitter();
    liveBlockTextRef.current = "";
    applyRender(EMPTY_RENDER);
  }, [applyRender]);

  const refreshHtml = useCallback(
    (source: string): void => {
      if (streaming && streamRender.enabled) refreshStream(source);
      else renderFull(source);
    },
    [refreshStream, renderFull, streamRender.enabled, streaming],
  );

  const paintDiagrams = useCallback((): void => {
    const root = rootEl.current;
    if (!root) return;
    const labels = diagramLabels;
    void Promise.all([
      mountMermaidIn(root, appearance.resolvedTheme === "dark", labels),
      mountDotIn(root, labels),
    ]);
  }, [appearance.resolvedTheme, diagramLabels]);

  const scheduleDiagrams = useCallback((): void => {
    if (diagramTimer.current) window.clearTimeout(diagramTimer.current);
    diagramTimer.current = window.setTimeout(() => {
      diagramTimer.current = 0;
      paintDiagrams();
    }, 140);
  }, [paintDiagrams]);

  const renderNow = useCallback(
    (source: string): void => {
      lastRenderAt.current = Date.now();
      refreshHtml(source);
      scheduleDiagrams();
    },
    [refreshHtml, scheduleDiagrams],
  );

  /** 流式 tick 快于一次渲染所需的时间时就按设置间隔合并，并带一次尾随补齐。 */
  const scheduleRender = useCallback(
    (source: string): void => {
      const throttleMs = streamRender.throttleMs;
      const elapsed = Date.now() - lastRenderAt.current;
      if (elapsed >= throttleMs) {
        renderNow(source);
        return;
      }
      pendingContent.current = source;
      if (!renderTimer.current) {
        renderTimer.current = window.setTimeout(() => {
          renderTimer.current = 0;
          const next = pendingContent.current;
          if (next == null) return;
          pendingContent.current = null;
          renderNow(next);
        }, throttleMs - elapsed);
      }
    },
    [renderNow, streamRender.throttleMs],
  );

  function openPreview(block: HTMLElement): void {
    const svg = getDiagramSvgMarkup(block);
    setPreviewSvg(svg);
    setPreviewSource(getDiagramSource(block));
    setPreviewKind(
      block.getAttribute("data-diagram") ||
        block.querySelector(".md-diagram-kind")?.textContent?.trim() ||
        "diagram",
    );
    setPreviewZoom(Math.max(1, readDiagramZoom(block)));
    setPreviewOpen(Boolean(svg));
  }

  function nudgePreviewZoom(factor: number): void {
    setPreviewZoom((current) => clampDiagramZoom(current * factor));
  }

  function resetPreviewZoom(): void {
    setPreviewZoom(1);
  }

  function copyPreviewSource(): void {
    if (!previewSource) return;
    void navigator.clipboard.writeText(previewSource).then(() => {
      message.success(t.copied);
    });
  }

  function downloadPreviewSvg(): void {
    if (!previewSvg) return;
    const blob = new Blob([previewSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagram-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(t.mdDiagramDownloaded);
  }

  const onRootClick = useCallback(
    (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const toolBtn = target.closest("[data-diagram-action]") as HTMLElement | null;
      if (toolBtn) {
        event.preventDefault();
        event.stopPropagation();
        const block = toolBtn.closest(".md-diagram") as HTMLElement | null;
        if (!block) return;
        const action = toolBtn.getAttribute("data-diagram-action") || "";
        const result = handleDiagramToolClick(block, action);
        if (result === "expand") openPreview(block);
        if (result === "copied") message.success(t.copied);
        if (result === "downloaded") message.success(t.mdDiagramDownloaded);
        return;
      }

      const copyBtn = target.closest("[data-copy]") as HTMLElement | null;
      if (copyBtn) {
        event.preventDefault();
        const block = copyBtn.closest("[data-code-block]");
        const code = block?.querySelector("code")?.textContent ?? "";
        void navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = t.copied;
          setTimeout(() => {
            copyBtn.textContent = t.copy;
          }, 1200);
        });
        return;
      }

      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor || !anchor.href) return;
      event.preventDefault();
      handleAppLinkClick(event, anchor.href, linkDialog);
    },
    [linkDialog, message, t],
  );

  const onRootWheel = useCallback((event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return;
    const target = event.target as HTMLElement | null;
    const block = target?.closest?.(".md-diagram.md-diagram-ready") as HTMLElement | null;
    if (!block) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    applyDiagramZoom(block, readDiagramZoom(block) * factor);
  }, []);

  const rootClickRef = useRef(onRootClick);
  rootClickRef.current = onRootClick;
  const rootWheelRef = useRef(onRootWheel);
  rootWheelRef.current = onRootWheel;
  const scheduleDiagramsRef = useRef(scheduleDiagrams);
  scheduleDiagramsRef.current = scheduleDiagrams;

  useEffect(() => {
    void streamRender.load();
  }, [streamRender]);

  useLayoutEffect(() => {
    setMarkdownCopyLabel(t.copy);
    refreshHtml(content);
    scheduleDiagramsRef.current();
  }, []);

  useEffect(() => {
    const root = rootEl.current;
    if (!root) return;
    const onClick = (event: MouseEvent): void => rootClickRef.current(event);
    const onWheel = (event: WheelEvent): void => rootWheelRef.current(event);
    root.addEventListener("click", onClick);
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (diagramTimer.current) window.clearTimeout(diagramTimer.current);
      if (renderTimer.current) window.clearTimeout(renderTimer.current);
      root.removeEventListener("click", onClick);
      root.removeEventListener("wheel", onWheel);
    };
  }, []);

  const prevContent = useRef<string | null>(null);
  useEffect(() => {
    if (prevContent.current === null) {
      prevContent.current = content;
      return;
    }
    if (prevContent.current === content) return;
    prevContent.current = content;
    scheduleRender(content);
  }, [content, scheduleRender]);

  const prevStreaming = useRef<boolean | undefined>(streaming);
  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = streaming;
    if (streaming && !wasStreaming) {
      resetStreamState();
      refreshStream(content);
      scheduleDiagrams();
      return;
    }
    if (wasStreaming && !streaming) renderNow(content);
  }, [streaming]);

  // 切换开关时按新模式重渲染当前回答，避免两套渲染结果叠加。
  const prevStreamEnabled = useRef(streamRender.enabled);
  useEffect(() => {
    const prev = prevStreamEnabled.current;
    prevStreamEnabled.current = streamRender.enabled;
    if (prev === streamRender.enabled) return;
    if (!streaming) return;
    resetStreamState();
    renderNow(content);
  }, [streamRender.enabled]);

  useEffect(() => {
    // Theme only affects Mermaid — avoid full markdown re-parse of every message.
    const root = rootEl.current;
    if (root) resetMermaidForTheme(root);
    scheduleDiagrams();
  }, [appearance.resolvedTheme, scheduleDiagrams]);

  const prevLocale = useRef(locale);
  useEffect(() => {
    const prev = prevLocale.current;
    prevLocale.current = locale;
    if (prev === locale) return;
    // 复制按钮文案烘焙在 HTML 里，切语言后重渲染当前 markdown。
    setMarkdownCopyLabel(t.copy);
    renderNow(content);
  }, [locale]);

  useEffect(() => {
    const el = previewViewportEl.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      nudgePreviewZoom(factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [previewOpen]);

  return (
    <>
      <div
        ref={rootEl}
        className={`md${variant === "chat" ? " md-chat" : ""}${styles.root}${className ? ` ${className}` : ""}`}
      >
        {renderState.blocks.map((block, index) => (
          <MarkdownHtml key={index} html={block} />
        ))}
        {renderState.liveBlock ? <MarkdownHtml html={renderState.liveBlock} /> : null}
        {renderState.liveTail ? (
          <div className="md-live-tail">{renderState.liveTail}</div>
        ) : null}
      </div>

      <Modal
        open={previewOpen}
        className={`pi-settings-modal ${styles.diagramFullscreenModal}`}
        style={{ width: "min(100vw, 100%)", maxWidth: "100vw" }}
        title={t.mdDiagramPreviewTitle(previewKind)}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
      >
        <div className={`modal-scroll ${styles.previewShell}`}>
          <div className={styles.previewToolbar}>
            <Space size={6} align="center">
              <Button size="small" onClick={() => nudgePreviewZoom(1 / 1.2)}>
                −
              </Button>
              <span className={styles.previewZoom}>{Math.round(previewZoom * 100)}%</span>
              <Button size="small" onClick={() => nudgePreviewZoom(1.2)}>
                +
              </Button>
              <Button size="small" onClick={resetPreviewZoom}>
                1:1
              </Button>
              <Button size="small" onClick={copyPreviewSource}>
                {t.mdDiagramCopySource}
              </Button>
              <Button size="small" onClick={downloadPreviewSvg}>
                {t.mdDiagramDownloadSvg}
              </Button>
              <span className={styles.previewHint}>{t.mdDiagramFullscreenHint}</span>
            </Space>
          </div>
          <div className={styles.previewViewport} ref={previewViewportEl}>
            <div
              className={styles.previewCanvas}
              style={{ transform: `scale(${previewZoom})` }}
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

export default MarkdownView;
