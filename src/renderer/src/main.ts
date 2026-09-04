import { createApp } from "vue";
import { createPinia } from "pinia";
// pi-lens-ignore: 2307
import App from "./App.vue";
import "./assets/main.css";
import {
  isLocaleReloading,
  showLocaleReloadSplash,
} from "./utils/locale-reload-splash";
import { hideStartupSplashInstantly } from "./utils/startup-splash";
import { markRendererStartup } from "./utils/startup-timing";

markRendererStartup("renderer:entry");

// Apply theme before first paint of Vue tree (CSP-safe; no inline HTML script).
try {
  const pref = localStorage.getItem("pi-desktop:theme-preference") || "system";
  const dark =
    pref === "dark" ||
    (pref !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {
  // ignore
}

// Cover the white reload flash when switching UI language.
if (isLocaleReloading()) {
  showLocaleReloadSplash();
  // The locale splash already covers the window; drop the startup splash.
  hideStartupSplashInstantly();
}

createApp(App).use(createPinia()).mount("#app");
markRendererStartup("renderer:mounted");
