import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Modal, Space } from "antd";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useMessage } from "@renderer/services/feedback";
import styles from "@renderer/components/MarkdownView.module.css";

type VizInstance = Awaited<ReturnType<typeof import("@viz-js/viz")["instance"]>>;

let vizPromise: Promise<VizInstance> | null = null;

function loadViz(): Promise<VizInstance> {
  vizPromise ??= (async () => {
    const { instance } = await import("@viz-js/viz");
    return instance();
  })();
  return vizPromise;
}

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.2;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function zoomIn(zoom: number): number {
  return clampZoom(zoom * ZOOM_STEP);
}

function zoomOut(zoom: number): number {
  return clampZoom(zoom / ZOOM_STEP);
}

type DotNode = { code?: string };

/** ```dot / ```koxgxsih / ```gv 图：viz.js 渲染 + 本项目的缩放、下载、全屏工具条。 */
export function DotDiagramNode({ node }: { node: DotNode }): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const source = useMemo(() => (node.code ?? "").trim(), [node.code]);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    void loadViz()
      .then((viz) => viz.renderString(source, { format: "svg" }))
      .then((markup) => {
        if (cancelled) return;
        setSvg(markup);
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSvg("");
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    const el = previewViewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setPreviewZoom((current) => clampZoom(current * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [previewOpen]);

  function copySource(): void {
    if (!source) return;
    void navigator.clipboard.writeText(source).then(() => {
      message.success(t.copied);
    });
  }

  function downloadSvg(): void {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diagram-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(t.mdDiagramDownloaded);
  }

  function openPreview(): void {
    setPreviewZoom(1);
    setPreviewOpen(true);
  }

  if (!svg) {
    return (
      <div
        className={`md-diagram${error ? " md-diagram-error" : ""}`}
        data-diagram="dot"
      >
        <pre className="md-diagram-src">{source}</pre>
        {error ? <div className="md-diagram-error-msg">{error.slice(0, 280)}</div> : null}
      </div>
    );
  }

  return (
    <>
      <div
        className="md-diagram md-diagram-ready"
        data-diagram="dot"
        data-zoom={String(zoom)}
      >
        <div className="md-diagram-toolbar">
          <span className="md-diagram-kind">koxgxsih</span>
          <span className="md-diagram-spacer" />
          <button
            type="button"
            className="md-diagram-btn"
            title={t.mdDiagramZoomOut}
            aria-label={t.mdDiagramZoomOut}
            onClick={() => setZoom(zoomOut)}
          >
            −
          </button>
          <span className="md-diagram-zoom">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="md-diagram-btn"
            title={t.mdDiagramZoomIn}
            aria-label={t.mdDiagramZoomIn}
            onClick={() => setZoom(zoomIn)}
          >
            +
          </button>
          <button
            type="button"
            className="md-diagram-btn"
            title={t.mdDiagramZoomReset}
            aria-label={t.mdDiagramZoomReset}
            onClick={() => setZoom(1)}
          >
            1:1
          </button>
          <button
            type="button"
            className="md-diagram-btn"
            title={t.mdDiagramExpand}
            aria-label={t.mdDiagramExpand}
            onClick={openPreview}
          >
            ⛶
          </button>
          <button
            type="button"
            className="md-diagram-btn"
            title={t.mdDiagramCopySource}
            aria-label={t.mdDiagramCopySource}
            onClick={copySource}
          >
            ⎘
          </button>
          <button
            type="button"
            className="md-diagram-btn"
            title={t.mdDiagramDownloadSvg}
            aria-label={t.mdDiagramDownloadSvg}
            onClick={downloadSvg}
          >
            ↓
          </button>
        </div>
        <div className="md-diagram-viewport" data-inner-scroll="">
          <div
            className="md-diagram-canvas"
            style={{ transform: `scale(${zoom})` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        <pre className="md-diagram-src" hidden>
          {source}
        </pre>
      </div>

      <Modal
        open={previewOpen}
        className={`pi-settings-modal ${styles.diagramFullscreenModal}`}
        style={{ width: "min(100vw, 100%)", maxWidth: "100vw" }}
        title={t.mdDiagramPreviewTitle("koxgxsih")}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
      >
        <div className={`modal-scroll ${styles.previewShell}`}>
          <div className={styles.previewToolbar}>
            <Space size={6} align="center">
              <Button size="small" onClick={() => setPreviewZoom(zoomOut)}>
                −
              </Button>
              <span className={styles.previewZoom}>
                {Math.round(previewZoom * 100)}%
              </span>
              <Button size="small" onClick={() => setPreviewZoom(zoomIn)}>
                +
              </Button>
              <Button size="small" onClick={() => setPreviewZoom(1)}>
                1:1
              </Button>
              <Button size="small" onClick={copySource}>
                {t.mdDiagramCopySource}
              </Button>
              <Button size="small" onClick={downloadSvg}>
                {t.mdDiagramDownloadSvg}
              </Button>
              <span className={styles.previewHint}>{t.mdDiagramFullscreenHint}</span>
            </Space>
          </div>
          <div className={styles.previewViewport} ref={previewViewportRef}>
            <div
              className={styles.previewCanvas}
              style={{ transform: `scale(${previewZoom})` }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
