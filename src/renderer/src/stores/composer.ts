import { defineStore } from "pinia";
import { ref } from "vue";
import type { ElementCitation } from "../../../shared/protocol";

export const useComposerStore = defineStore("composer", () => {
  const draft = ref("");
  const citations = ref<ElementCitation[]>([]);

  function addCitation(citation: ElementCitation): void {
    citations.value = [...citations.value, citation];
  }

  function removeCitation(index: number): void {
    citations.value = citations.value.filter((_, i) => i !== index);
  }

  function clear(): void {
    draft.value = "";
    citations.value = [];
  }

  return {
    draft,
    citations,
    addCitation,
    removeCitation,
    clear,
  };
});
