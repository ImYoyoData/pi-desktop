import { defineStore } from "pinia";
import { ref } from "vue";

export const usePreviewStore = defineStore("preview", () => {
  const filePath = ref<string | null>(null);
  let openNonce = 0;
  const openSignal = ref(0);

  function openPreview(path: string): void {
    filePath.value = path.replace(/\\/g, "/");
    openNonce += 1;
    openSignal.value = openNonce;
  }

  return { filePath, openSignal, openPreview };
});
