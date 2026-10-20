import {
  Children,
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type SplitPanesResizedPayload = { panes: { size: number }[] };

type PaneMeta = { min: number; max: number };

type SplitPanesContextValue = {
  registerPane: (element: HTMLElement, meta: PaneMeta) => void;
  unregisterPane: (element: HTMLElement) => void;
};

const SplitPanesContext = createContext<SplitPanesContextValue | null>(null);

export type SplitPanesProps = {
  /** 分隔线为水平方向：面板上下排列；默认左右排列。 */
  horizontal?: boolean;
  className?: string;
  children: ReactNode;
  onResized?: (payload: SplitPanesResizedPayload) => void;
};

export type SplitPaneProps = {
  /** 面板占容器的百分比，各面板之和为 100。 */
  size: number;
  minSize?: number;
  maxSize?: number;
  className?: string;
  children?: ReactNode;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readBasisSize(element: HTMLElement): number {
  const basis = element.style.flexBasis;
  const value = Number.parseFloat(basis);
  return Number.isFinite(value) ? value : 0;
}

export function SplitPanes({
  horizontal = false,
  className,
  children,
  onResized,
}: SplitPanesProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const metasRef = useRef<Map<HTMLElement, PaneMeta>>(new Map());
  const dragRef = useRef<{
    index: number;
    startPos: number;
    startSizes: number[];
    total: number;
    metaA: PaneMeta;
    metaB: PaneMeta;
  } | null>(null);

  const registerPane = useCallback((element: HTMLElement, meta: PaneMeta) => {
    metasRef.current.set(element, meta);
  }, []);

  const unregisterPane = useCallback((element: HTMLElement) => {
    metasRef.current.delete(element);
  }, []);

  const contextValue = useMemo(
    () => ({ registerPane, unregisterPane }),
    [registerPane, unregisterPane],
  );

  const readPaneElements = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>("[data-split-pane]"));
  }, []);

  const handleMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const position = horizontal ? event.clientY : event.clientX;
      const delta = ((position - drag.startPos) / drag.total) * 100;
      const sizes = drag.startSizes.slice();
      const a = drag.index;
      const b = a + 1;
      const pairTotal = sizes[a] + sizes[b];
      const metaA = drag.metaA;
      const metaB = drag.metaB;
      let nextA = clamp(sizes[a] + delta, metaA.min, metaA.max);
      let nextB = clamp(pairTotal - nextA, metaB.min, metaB.max);
      nextA = clamp(pairTotal - nextB, metaA.min, metaA.max);
      sizes[a] = nextA;
      sizes[b] = nextB;
      onResized?.({ panes: sizes.map((size) => ({ size })) });
    },
    [horizontal, onResized],
  );

  const handleUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  }, [handleMove]);

  const handleSplitterDown =
    (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const panes = readPaneElements();
      if (panes.length < 2) return;
      const sizes = panes.map(readBasisSize);
      let total = 0;
      for (const pane of panes) {
        const rect = pane.getBoundingClientRect();
        total += horizontal ? rect.height : rect.width;
      }
      if (total <= 0) return;
      const fallback = { min: 0, max: 100 };
      dragRef.current = {
        index,
        startPos: horizontal ? event.clientY : event.clientX,
        startSizes: sizes,
        total,
        metaA: metasRef.current.get(panes[index]) ?? fallback,
        metaB: metasRef.current.get(panes[index + 1]) ?? fallback,
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [handleMove, handleUp]);

  const items = Children.toArray(children);

  return (
    <SplitPanesContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={`splitpanes splitpanes--${horizontal ? "horizontal" : "vertical"}${
          className ? ` ${className}` : ""
        }`}
      >
        {items.map((child, index) => (
          <Fragment key={index}>
            {child}
            {index < items.length - 1 ? (
              <div
                className="splitpanes__splitter"
                role="separator"
                onPointerDown={handleSplitterDown(index)}
              />
            ) : null}
          </Fragment>
        ))}
      </div>
    </SplitPanesContext.Provider>
  );
}

export function SplitPane({
  size,
  minSize = 0,
  maxSize = 100,
  className,
  children,
}: SplitPaneProps): ReactNode {
  const context = useContext(SplitPanesContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!context || !element) return;
    context.registerPane(element, { min: minSize, max: maxSize });
    return () => context.unregisterPane(element);
  }, [context, maxSize, minSize]);

  return (
    <div
      ref={ref}
      data-split-pane=""
      className={`splitpanes__pane${className ? ` ${className}` : ""}`}
      style={{ flexBasis: `${size}%`, flexGrow: 0, flexShrink: 1 }}
    >
      {children}
    </div>
  );
}
