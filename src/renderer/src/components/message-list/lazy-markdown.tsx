import { lazy } from "react";

/**
 * Markdown rendering pulls katex / marked / highlight.js — load it lazily
 * so opening a session with many messages stays responsive on slow CPUs.
 */
const loadMarkdownView = () => import("@renderer/components/MarkdownView");

export const MarkdownView = lazy(loadMarkdownView);

/** 空闲时先拉正文渲染器，首次展开思考 / 首条消息不再等 chunk 编译。 */
export function preloadMarkdownView(): () => void {
  let cancelled = false;
  const run = (): void => {
    if (!cancelled) void loadMarkdownView();
  };
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 2_000 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(handle);
    };
  }
  const timer = window.setTimeout(run, 600);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}
