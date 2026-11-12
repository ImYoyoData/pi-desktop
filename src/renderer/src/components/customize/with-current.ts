/** 带数值的下拉选项。 */
export type NumericOption<V extends number | string = number> = {
  label: string;
  value: V;
};

/**
 * 手写的非档位值也要能回显：并入选项，避免下拉把用户值显示成别的档位。
 */
export function withCurrent<V extends number | string>(
  options: NumericOption<V>[],
  current: number,
): NumericOption<V>[] {
  if (options.some((option) => option.value === current)) return options;
  return [...options, { label: current.toLocaleString(), value: current as V }].sort(
    (a, b) => Number(a.value) - Number(b.value),
  );
}
