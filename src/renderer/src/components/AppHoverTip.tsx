import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "antd";

/** 提示延迟，接近系统原生 title 的节奏，避免指针扫过时乱跳 */
const SHOW_DELAY_MS = 350;

type TipState = { text: string; x: number; y: number };

export function AppHoverTip(): ReactNode {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer = 0;

    /** 临时摘除的 title 必须还原：Vue 重设过 title 时以新值为准 */
    function restoreTitle(el: HTMLElement): void {
      const saved = el.dataset.piTip;
      if (saved === undefined) return;
      delete el.dataset.piTip;
      if (!el.hasAttribute("title")) el.setAttribute("title", saved);
    }

    function hide(): void {
      window.clearTimeout(timer);
      setTip(null);
      if (target) {
        restoreTitle(target);
        target = null;
      }
    }

    function showFor(el: HTMLElement): void {
      if (target === el) return;
      hide();
      const title = el.getAttribute("title");
      if (!title) return;
      target = el;
      el.dataset.piTip = title;
      el.removeAttribute("title");
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top;
      timer = window.setTimeout(() => {
        setTip({ text: title, x, y });
      }, SHOW_DELAY_MS);
    }

    function onPointerOver(event: PointerEvent): void {
      const node = event.target as HTMLElement | null;
      const el = node?.closest?.("[title]") as HTMLElement | null;
      if (el) {
        showFor(el);
        return;
      }
      if (target && node && !target.contains(node)) hide();
    }

    function onPointerOut(event: PointerEvent): void {
      if (!target) return;
      const next = event.relatedTarget as Node | null;
      if (next && target.contains(next)) return;
      hide();
    }

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);

    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      hide();
    };
  }, []);

  if (!tip) return null;

  return createPortal(
    <Tooltip
      open
      title={tip.text}
      placement="top"
      overlayStyle={{ maxWidth: "340px" }}
    >
      <span
        style={{
          position: "fixed",
          left: tip.x,
          top: tip.y,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      />
    </Tooltip>,
    document.body,
  );
}

export default AppHoverTip;
