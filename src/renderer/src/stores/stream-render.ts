import { create } from "zustand";
import {
  DEFAULT_STREAM_RENDER_SETTINGS,
  type StreamRenderSettings,
} from "../../../shared/stream-render";

type StreamRenderState = {
  enabled: boolean;
  throttleMs: number;
  load: () => Promise<void>;
  update: (next: Partial<StreamRenderSettings>) => Promise<void>;
  /** 另一端改了设置后重新读取并应用。 */
  refresh: () => Promise<void>;
};

/** 「流式渲染」设置：主进程持久化，渲染端与会话 worker 共用同一份开关。 */
export const useStreamRenderStore = create<StreamRenderState>()((set, get) => {
  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        const saved = await window.api.streamRender.get();
        set({ enabled: saved.enabled, throttleMs: saved.throttleMs });
      } catch {
        // 读取失败时保持默认值
      }
    })();
    return loading;
  }

  async function update(next: Partial<StreamRenderSettings>): Promise<void> {
    const saved = await window.api.streamRender.set({
      enabled: get().enabled,
      throttleMs: get().throttleMs,
      ...next,
    });
    set({ enabled: saved.enabled, throttleMs: saved.throttleMs });
  }

  async function refresh(): Promise<void> {
    try {
      const saved = await window.api.streamRender.get();
      set({ enabled: saved.enabled, throttleMs: saved.throttleMs });
    } catch {
      // 读取失败时保持当前值
    }
  }

  return {
    enabled: DEFAULT_STREAM_RENDER_SETTINGS.enabled,
    throttleMs: DEFAULT_STREAM_RENDER_SETTINGS.throttleMs,
    load,
    update,
    refresh,
  };
});
