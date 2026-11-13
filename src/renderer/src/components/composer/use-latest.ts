import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

export type Latest<T> = {
  readonly value: T;
  ref: MutableRefObject<T>;
  set: (next: T) => void;
};

export function useLatest<T>(initial: T): Latest<T> {
  const [, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  /**
   * `value` 直读 ref：set 之后同一 tick 内读到的就是新值。
   * 若改用 state 快照，写入后未重渲染前读到的是旧值——
   * 例如 refreshModels 写完模型列表紧接着读它，会读到空列表而把模型回落成占位符。
   */
  return useMemo(
    () => ({
      get value(): T {
        return ref.current;
      },
      ref,
      set,
    }),
    [set],
  );
}
