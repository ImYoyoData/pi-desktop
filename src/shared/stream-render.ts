/** 「流式渲染」设置：平滑开关控制渲染节奏，刷新间隔控制快照合并与提交帧率。 */

export type StreamRenderSettings = {
  /** 平滑流式渲染：输出节奏交给 markstream 的 smoothStreaming。 */
  smooth: boolean;
  /** 流式刷新间隔（ms）：会话 worker 的快照合并与渲染提交帧率共用。0 表示不节流。 */
  throttleMs: number;
};

export const DEFAULT_STREAM_RENDER_SETTINGS: StreamRenderSettings = {
  smooth: true,
  throttleMs: 40,
};

/** 0 表示不节流，逐帧刷新。 */
export const STREAM_RENDER_THROTTLE_CHOICES = [0, 40, 60, 90, 120, 200] as const;

export function parseStreamRenderSettings(raw: unknown): StreamRenderSettings {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const value = Number(source.throttleMs);
  const throttleMs = (STREAM_RENDER_THROTTLE_CHOICES as readonly number[]).includes(
    value,
  )
    ? value
    : DEFAULT_STREAM_RENDER_SETTINGS.throttleMs;
  // 旧配置用 enabled 表示同一个开关，缺字段时保持默认。
  const smooth =
    typeof source.smooth === "boolean"
      ? source.smooth
      : typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_STREAM_RENDER_SETTINGS.smooth;
  return { smooth, throttleMs };
}
