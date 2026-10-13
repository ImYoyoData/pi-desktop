import { createApp } from "vue";
import { createPinia } from "pinia";
// pi-lens-ignore: 2307
import App from "./App.vue";
import "./assets/main.css";
import "./assets/vscode-syntax.css";
import "./assets/wallpaper.css";
import { markRendererStartup } from "./utils/startup-timing";
import { bootstrapAppEvents } from "./app-events";
import * as prefs from "@renderer/utils/prefs";
import {
  CUSTOM_APPEARANCE_KEY,
  CUSTOM_APPEARANCE_LEGACY_KEY,
} from "../../shared/appearance";

markRendererStartup("renderer:entry");

// Apply theme before first paint of Vue tree (CSP-safe; no inline HTML script).
try {
  const pref = prefs.getItem("pi-desktop:theme-preference") || "system";
  const custom =
    prefs.getItem(CUSTOM_APPEARANCE_KEY) ??
    prefs.getItem(CUSTOM_APPEARANCE_LEGACY_KEY);
  // 壁纸模式固定深色玻璃，首帧就得按暗色渲染
  const wallpaper = custom ? JSON.parse(custom)?.wallpaper : null;
  const dark =
    wallpaper?.kind === "image" ||
    wallpaper?.kind === "video" ||
    pref === "dark" ||
    (pref !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {
  // ignore
}

const app = createApp(App);

/**
 * 渲染层错误必须可见：没有处理器时一次组件抛错只会静默停更该组件
 * （消息列表停住、其余 UI 照常），看上去像“会话卡住”。
 */
app.config.errorHandler = (err, _instance, info) => {
  console.error(`[renderer] component error (${info}):`, err);
};
window.addEventListener("error", (event) => {
  console.error("[renderer] error:", event.message, event.error);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[renderer] unhandled rejection:", event.reason);
});

app.use(createPinia()).mount("#app");
// mount 之后同步注册，中间不会有 IPC 事件到达；进程级订阅不能交给组件生命周期。
bootstrapAppEvents();
markRendererStartup("renderer:mounted");
