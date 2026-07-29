import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./assets/main.css";
import {
  isLocaleReloading,
  showLocaleReloadSplash,
} from "./utils/locale-reload-splash";

// Apply theme before first paint of Vue tree (CSP-safe; no inline HTML script).
try {
  const pref = localStorage.getItem("pi-desktop:theme-preference") || "system";
  const dark =
    pref === "dark" ||
    (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {
  // ignore
}

// Cover the white reload flash when switching UI language.
if (isLocaleReloading()) {
  showLocaleReloadSplash();
}

createApp(App).use(createPinia()).mount("#app");
