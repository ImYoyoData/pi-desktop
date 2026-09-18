import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_STREAM_RENDER_SETTINGS,
  type StreamRenderSettings,
} from "../../../shared/stream-render";

/** 「流式渲染」设置：主进程持久化，渲染端与会话 worker 共用同一份开关。 */
export const useStreamRenderStore = defineStore("stream-render", () => {
  const enabled = ref(DEFAULT_STREAM_RENDER_SETTINGS.enabled);
  const throttleMs = ref(DEFAULT_STREAM_RENDER_SETTINGS.throttleMs);
  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        const saved = await window.api.streamRender.get();
        enabled.value = saved.enabled;
        throttleMs.value = saved.throttleMs;
      } catch {
        // 读取失败时保持默认值
      }
    })();
    return loading;
  }

  async function update(next: Partial<StreamRenderSettings>): Promise<void> {
    const saved = await window.api.streamRender.set({
      enabled: enabled.value,
      throttleMs: throttleMs.value,
      ...next,
    });
    enabled.value = saved.enabled;
    throttleMs.value = saved.throttleMs;
  }

  return { enabled, throttleMs, load, update };
});
