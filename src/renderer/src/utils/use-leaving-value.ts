import { useEffect, useState } from "react";

/** 保留上一个值 ms 毫秒，供离场动画读取；值不变时不产生额外渲染。 */
export function useLeavingValue<T>(value: T, ms: number): T | null {
  const [tracked, setTracked] = useState(value);
  const [leaving, setLeaving] = useState<T | null>(null);

  if (tracked !== value) {
    setTracked(value);
    setLeaving(tracked);
  }

  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => setLeaving(null), ms);
    return () => window.clearTimeout(timer);
  }, [leaving, ms]);

  return leaving;
}
