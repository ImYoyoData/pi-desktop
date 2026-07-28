/** Keep the first `running` tab at index 0; extras stay after the rest. */
export function pinRunningFirst<T extends { kind: string }>(tabs: T[]): T[] {
  const running = tabs.filter((t) => t.kind === "running");
  const rest = tabs.filter((t) => t.kind !== "running");
  if (running.length === 0) return tabs;
  return [running[0]!, ...rest, ...running.slice(1)];
}
