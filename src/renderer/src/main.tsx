import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/main.css";
import "./assets/vscode-syntax.css";
import "./assets/wallpaper.css";
import { markRendererStartup } from "./utils/startup-timing";
import { bootstrapAppEvents } from "./app-events";
import { bootstrapScrollAutoHide } from "./utils/scroll-auto-hide";
import * as prefs from "@renderer/utils/prefs";
import {
  CUSTOM_APPEARANCE_KEY,
  CUSTOM_APPEARANCE_LEGACY_KEY,
} from "../../shared/appearance";

markRendererStartup("renderer:entry");

/** 主题在 React 树首帧前落到 DOM，避免闪烁（CSP 安全：不注入内联脚本）。 */
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

/**
 * 渲染层错误必须可见：没有处理器时一次渲染抛错只会静默停更该组件
 * （消息列表停住、其余 UI 照常），看上去像“会话卡住”。
 */
window.addEventListener("error", (event) => {
  console.error("[renderer] error:", event.message, event.error);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[renderer] unhandled rejection:", event.reason);
});

const container = document.getElementById("app");
if (!container) throw new Error("挂载点 #app 不存在");

// 进程级订阅不挂在组件生命周期上，先于首帧注册，避免漏掉主进程推送的事件。
bootstrapAppEvents();
// 滚动条空闲自动隐藏，同样是进程级行为。
bootstrapScrollAutoHide();

createRoot(container).render(<App />);
markRendererStartup("renderer:mounted");
