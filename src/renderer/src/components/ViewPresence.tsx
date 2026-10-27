import { useEffect, useState, type ReactNode } from "react";

type ViewLayer = { id: string; phase: "enter" | "leave" };

type Props = {
  /** 当前视图；null 表示回到常驻视图，不再渲染覆盖层。 */
  viewId: string | null;
  /** 离场动画时长，与 CSS 时长保持同步并留出余量。 */
  exitMs?: number;
  render: (id: string) => ReactNode;
};

/**
 * 主区页面切换：离场页面保留到动画结束，与进场页面交叉淡入淡出。
 * 只走透明度和位移，页面内组件实例、滚动位置与内部状态都不重建。
 */
export function ViewPresence({ viewId, exitMs = 160, render }: Props): ReactNode {
  const [layers, setLayers] = useState<ViewLayer[]>(() =>
    viewId ? [{ id: viewId, phase: "enter" }] : [],
  );
  const [trackedId, setTrackedId] = useState(viewId);

  if (trackedId !== viewId) {
    setTrackedId(viewId);
    setLayers((prev) => {
      const leaving = prev
        .filter((layer) => layer.id !== viewId)
        .map((layer) => ({ id: layer.id, phase: "leave" as const }));
      return viewId ? [...leaving, { id: viewId, phase: "enter" }] : leaving;
    });
  }

  const hasLeaving = layers.some((layer) => layer.phase === "leave");

  useEffect(() => {
    if (!hasLeaving) return;
    const timer = window.setTimeout(() => {
      setLayers((prev) => prev.filter((layer) => layer.phase !== "leave"));
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [hasLeaving, layers, exitMs]);

  return (
    <>
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`pane-capsule pane-capsule--overlay view-layer-${layer.phase}`}
        >
          {render(layer.id)}
        </div>
      ))}
    </>
  );
}

export default ViewPresence;
