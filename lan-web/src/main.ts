import { createApp } from "vue";
import { createPinia } from "pinia";
import { installLanWindowApi } from "./shim-api";
import App from "./App.vue";

installLanWindowApi();

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
