import { createApp } from "vue";
import { createPinia } from "pinia";
import { installLanWindowApi } from "./shim-api";
import { useAppearanceStore } from "@renderer/stores/appearance";
import App from "./App.vue";

installLanWindowApi();

const app = createApp(App);
app.use(createPinia());
// Match desktop: sync document theme + highlight.js sheet (fixes dark-mode code contrast).
useAppearanceStore().init();
app.mount("#app");
