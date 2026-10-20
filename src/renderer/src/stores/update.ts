import { create } from "zustand";
import type { UpdateCheckResult, UpdateProgress } from "../../../shared/update";
import * as prefs from "@renderer/utils/prefs";

const AUTO_CHECK_KEY = "pi-desktop:last-update-check";
let startupChecked = false;

type UpdateBase = {
  available: boolean;
  checking: boolean;
  downloading: boolean;
  modalOpen: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  assetName: string | null;
  statusMessage: string;
  lastError: string | null;
  progress: UpdateProgress | null;
  cancelling: boolean;
};

type UpdateDerived = {
  busy: boolean;
  progressPercent: number | null;
};

type UpdateState = UpdateBase &
  UpdateDerived & {
    check: (opts?: { openModal?: boolean }) => Promise<UpdateCheckResult | null>;
    checkOnStartup: () => Promise<void>;
    openUpdateCard: () => Promise<void>;
    download: () => Promise<UpdateCheckResult | null>;
    cancel: () => Promise<boolean>;
    onProgress: (p: UpdateProgress) => void;
    closeModal: () => void;
  };

function progressPercentOf(progress: UpdateProgress | null): number | null {
  if (!progress || !progress.totalBytes || progress.totalBytes <= 0) return null;
  return Math.min(
    100,
    Math.round((progress.receivedBytes / progress.totalBytes) * 100),
  );
}

function derive(base: UpdateBase): UpdateDerived {
  return {
    busy: base.checking || base.downloading,
    progressPercent: progressPercentOf(base.progress),
  };
}

export const useUpdateStore = create<UpdateState>()((set, get) => {
  function writeBase(patch: Partial<UpdateBase>): void {
    set((state) => {
      const next = { ...state, ...patch };
      return { ...patch, ...derive(next) };
    });
  }

  function applyResult(result: UpdateCheckResult): void {
    const state = get();
    const patch: Partial<UpdateBase> = {
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion ?? state.latestVersion,
      releaseName: result.releaseName ?? state.releaseName,
      releaseNotes: result.releaseNotes ?? state.releaseNotes,
      releaseUrl: result.releaseUrl ?? state.releaseUrl,
      assetName: result.assetName ?? state.assetName,
      statusMessage: result.message,
    };
    if (result.status === "available") {
      patch.available = true;
    } else if (result.status === "upToDate" || result.status === "downloaded") {
      patch.available = false;
    } else if (result.status === "cancelled") {
      patch.available = true;
    }
    if (result.status === "error") {
      patch.lastError = result.message;
    } else if (result.status === "available" || result.status === "upToDate") {
      patch.lastError = null;
    }
    writeBase(patch);
  }

  function markChecked(): void {
    try {
      prefs.setItem(AUTO_CHECK_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }

  async function check(
    opts?: { openModal?: boolean },
  ): Promise<UpdateCheckResult | null> {
    if (get().busy) return null;
    writeBase({ checking: true, lastError: null });
    try {
      const result = await window.api.update.check({ download: false });
      applyResult(result);
      markChecked();
      if (opts?.openModal) {
        writeBase({ modalOpen: true });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeBase({ lastError: message, statusMessage: message });
      if (opts?.openModal) writeBase({ modalOpen: true });
      return null;
    } finally {
      writeBase({ checking: false });
    }
  }

  /** Startup: silent check once per process — red badge only. */
  async function checkOnStartup(): Promise<void> {
    if (startupChecked) return;
    startupChecked = true;
    await check({ openModal: false });
  }

  /** Title-bar / About button: open card (refresh check if needed). */
  async function openUpdateCard(): Promise<void> {
    writeBase({ modalOpen: true });
    const state = get();
    if (!state.latestVersion || !state.available) {
      await check({ openModal: true });
    }
  }

  async function download(): Promise<UpdateCheckResult | null> {
    if (get().busy) return null;
    writeBase({
      downloading: true,
      progress: {
        phase: "download",
        receivedBytes: 0,
        totalBytes: null,
        message: "",
      },
    });
    try {
      const result = await window.api.update.download();
      applyResult(result);
      if (result.status === "downloaded") {
        writeBase({ available: false });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeBase({
        lastError: message,
        progress: {
          phase: "error",
          receivedBytes: 0,
          totalBytes: null,
          message,
        },
      });
      return null;
    } finally {
      writeBase({ downloading: false });
    }
  }

  function onProgress(p: UpdateProgress): void {
    if (p.phase === "error") {
      writeBase({ progress: p, lastError: p.message });
      return;
    }
    writeBase({ progress: p });
  }

  /** 取消正在进行的安装包下载。 */
  async function cancel(): Promise<boolean> {
    const state = get();
    if (!state.downloading || state.cancelling) return false;
    writeBase({ cancelling: true });
    try {
      return await window.api.update.cancel();
    } finally {
      writeBase({ cancelling: false });
    }
  }

  function closeModal(): void {
    writeBase({ modalOpen: false });
  }

  const base: UpdateBase = {
    available: false,
    checking: false,
    downloading: false,
    modalOpen: false,
    currentVersion: "",
    latestVersion: null,
    releaseName: null,
    releaseNotes: null,
    releaseUrl: null,
    assetName: null,
    statusMessage: "",
    lastError: null,
    progress: null,
    cancelling: false,
  };

  return {
    ...base,
    ...derive(base),
    check,
    checkOnStartup,
    openUpdateCard,
    download,
    cancel,
    onProgress,
    closeModal,
  };
});
