import { create } from "zustand";

type PreviewState = {
  filePath: string | null;
  openSignal: number;
  openPreview: (path: string) => void;
};

export const usePreviewStore = create<PreviewState>()((set) => {
  let openNonce = 0;

  function openPreview(path: string): void {
    openNonce += 1;
    set({ filePath: path.replace(/\\/g, "/"), openSignal: openNonce });
  }

  return { filePath: null, openSignal: 0, openPreview };
});
