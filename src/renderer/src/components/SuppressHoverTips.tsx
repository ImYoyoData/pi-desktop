import { useEffect } from "react";

/**
 * 全局关闭悬停提示：指针进入时摘下 title，阻止系统气泡。
 * 只处理 DOM title 属性，带 ? 的说明提示走 Tooltip 组件，不受影响。
 */
export function SuppressHoverTips(): null {
  useEffect(() => {
    let target: HTMLElement | null = null;

    function restore(): void {
      if (!target) return;
      const saved = target.dataset.piTitle;
      delete target.dataset.piTitle;
      if (saved !== undefined && !target.hasAttribute("title")) {
        target.setAttribute("title", saved);
      }
      target = null;
    }

    function onPointerOver(event: PointerEvent): void {
      const node = event.target as HTMLElement | null;
      if (target && node && target.contains(node)) return;
      restore();
      const el = node?.closest?.("[title]") as HTMLElement | null;
      if (!el) return;
      target = el;
      el.dataset.piTitle = el.getAttribute("title") ?? "";
      el.removeAttribute("title");
    }

    document.addEventListener("pointerover", onPointerOver, true);
    window.addEventListener("blur", restore);

    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      window.removeEventListener("blur", restore);
      restore();
    };
  }, []);

  return null;
}

export default SuppressHoverTips;
