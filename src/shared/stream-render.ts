/** 「流式渲染」设置：开关与参数分离，参数仅在开关开启时生效。 */

export type StreamRenderSettings = {
  enabled: boolean;
  /** markdown 渲染节流间隔（ms）。 */
  throttleMs: number;
};

export const DEFAULT_STREAM_RENDER_SETTINGS: StreamRenderSettings = {
  enabled: false,
  throttleMs: 90,
};

/** 0 表示不节流，逐帧实时渲染。 */
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
  return { enabled: source.enabled === true, throttleMs };
}
