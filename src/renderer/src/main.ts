import { createApp } from "vue";
import { createPinia } from "pinia";
// pi-lens-ignore: 2307
import App from "./App.vue";
import "./assets/main.css";
import "./assets/vscode-syntax.css";
import "./assets/wallpaper.css";
import { markRendererStartup } from "./utils/startup-timing";
import {
  CUSTOM_APPEARANCE_KEY,
  CUSTOM_APPEARANCE_LEGACY_KEY,
} from "../../shared/appearance";

markRendererStartup("renderer:entry");

// Apply theme before first paint of Vue tree (CSP-safe; no inline HTML script).
try {
  const pref = localStorage.getItem("pi-desktop:theme-preference") || "system";
  const custom =
    localStorage.getItem(CUSTOM_APPEARANCE_KEY) ??
    localStorage.getItem(CUSTOM_APPEARANCE_LEGACY_KEY);
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

createApp(App).use(createPinia()).mount("#app");
markRendererStartup("renderer:mounted");
