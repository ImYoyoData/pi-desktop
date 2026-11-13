import { useEffect, useState, type ReactNode } from "react";

type ViewLayer = { id: string; phase: "enter" | "leave"; deadline?: number };

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
  const [state, setState] = useState<{ trackedId: string | null; layers: ViewLayer[] }>(() => ({
    trackedId: viewId,
    layers: viewId ? [{ id: viewId, phase: "enter" }] : [],
  }));

  if (state.trackedId !== viewId) {
    setState((prev) => {
      const now = Date.now();
      const leaving = prev.layers
        .filter((layer) => layer.id !== viewId)
        .map((layer) => ({
          id: layer.id,
          phase: "leave" as const,
          deadline: now + exitMs,
        }));
      return {
        trackedId: viewId,
        layers: viewId ? [...leaving, { id: viewId, phase: "enter" }] : leaving,
      };
    });
  }

  const { layers } = state;

  /** 每个离场 layer 记自己的 deadline，连续切页不会拉长旧页面的离场时间。 */
  useEffect(() => {
    const pending = layers.filter((layer) => layer.phase === "leave");
    if (!pending.length) return;
    const soonest = Math.min(...pending.map((layer) => layer.deadline ?? 0));
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        setState((prev) => ({
          ...prev,
          layers: prev.layers.filter(
            (layer) => layer.phase !== "leave" || (layer.deadline ?? 0) > now,
          ),
        }));
      },
      Math.max(0, soonest - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [layers, exitMs]);

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
