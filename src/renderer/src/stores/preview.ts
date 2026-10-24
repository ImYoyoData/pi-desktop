import { create } from "zustand";
import * as prefs from "@renderer/utils/prefs";
import { useWorkspaceStore } from "@renderer/stores/workspace";

type PreviewState = {
  filePath: string | null;
  openSignal: number;
  openPreview: (path: string) => void;
  /** 另一端打开了别的文件后重新读取并应用。 */
  refreshFromPrefs: () => void;
};

export const PREVIEW_SYNC_PREFIX = "pi-desktop:preview:v1:";

function previewKey(root: string): string {
  return `${PREVIEW_SYNC_PREFIX}${root.replace(/\\/g, "/").toLowerCase()}`;
}

export const usePreviewStore = create<PreviewState>()((set, get) => {
  let openNonce = 0;

  function openPreview(path: string): void {
    const normalized = path.replace(/\\/g, "/");
    const root = useWorkspaceStore.getState().root;
    // 记到偏好里：另一窗口打开别的文件时跟着切。
    if (root) {
      try {
        prefs.setItem(previewKey(root), normalized);
      } catch {
        // ignore
      }
    }
    openNonce += 1;
    set({ filePath: normalized, openSignal: openNonce });
  }

  function refreshFromPrefs(): void {
    const root = useWorkspaceStore.getState().root;
    if (!root) return;
    const next = prefs.getItem(previewKey(root)) ?? "";
    if (next === get().filePath) return;
    openNonce += 1;
    set({ filePath: next, openSignal: openNonce });
  }

  return { filePath: null, openSignal: 0, openPreview, refreshFromPrefs };
});
