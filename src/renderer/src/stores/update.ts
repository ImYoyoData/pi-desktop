import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { UpdateCheckResult, UpdateProgress } from "../../../shared/update";

const AUTO_CHECK_KEY = "pi-desktop:last-update-check";
let startupChecked = false;

export const useUpdateStore = defineStore("update", () => {
  const available = ref(false);
  const checking = ref(false);
  const downloading = ref(false);
  const modalOpen = ref(false);
  const currentVersion = ref("");
  const latestVersion = ref<string | null>(null);
  const releaseName = ref<string | null>(null);
  const releaseNotes = ref<string | null>(null);
  const releaseUrl = ref<string | null>(null);
  const assetName = ref<string | null>(null);
  const statusMessage = ref("");
  const lastError = ref<string | null>(null);
  const progress = ref<UpdateProgress | null>(null);

  const busy = computed(() => checking.value || downloading.value);
  const progressPercent = computed(() => {
    const p = progress.value;
    if (!p || !p.totalBytes || p.totalBytes <= 0) return null;
    return Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100));
  });

  function applyResult(result: UpdateCheckResult): void {
    currentVersion.value = result.currentVersion;
    latestVersion.value = result.latestVersion ?? latestVersion.value;
    releaseName.value = result.releaseName ?? releaseName.value;
    releaseNotes.value = result.releaseNotes ?? releaseNotes.value;
    releaseUrl.value = result.releaseUrl ?? releaseUrl.value;
    assetName.value = result.assetName ?? assetName.value;
    statusMessage.value = result.message;
    if (result.status === "available") {
      available.value = true;
    } else if (result.status === "upToDate" || result.status === "downloaded") {
      available.value = false;
    }
    if (result.status === "error") {
      lastError.value = result.message;
    } else if (result.status === "available" || result.status === "upToDate") {
      lastError.value = null;
    }
  }

  function markChecked(): void {
    try {
      localStorage.setItem(AUTO_CHECK_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  }

  async function check(opts?: { openModal?: boolean }): Promise<UpdateCheckResult | null> {
    if (busy.value) return null;
    checking.value = true;
    lastError.value = null;
    try {
      const result = await window.api.update.check({ download: false });
      applyResult(result);
      markChecked();
      if (opts?.openModal) {
        modalOpen.value = true;
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError.value = message;
      statusMessage.value = message;
      if (opts?.openModal) modalOpen.value = true;
      return null;
    } finally {
      checking.value = false;
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
    modalOpen.value = true;
    if (!latestVersion.value || !available.value) {
      await check({ openModal: true });
    }
  }

  async function download(): Promise<UpdateCheckResult | null> {
    if (busy.value) return null;
    downloading.value = true;
    progress.value = {
      phase: "download",
      receivedBytes: 0,
      totalBytes: null,
      message: "",
    };
    try {
      const result = await window.api.update.download();
      applyResult(result);
      if (result.status === "downloaded") {
        available.value = false;
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError.value = message;
      progress.value = {
        phase: "error",
        receivedBytes: 0,
        totalBytes: null,
        message,
      };
      return null;
    } finally {
      downloading.value = false;
    }
  }

  function onProgress(p: UpdateProgress): void {
    progress.value = p;
    if (p.phase === "error") {
      lastError.value = p.message;
    }
  }

  function closeModal(): void {
    modalOpen.value = false;
  }

  return {
    available,
    checking,
    downloading,
    busy,
    modalOpen,
    currentVersion,
    latestVersion,
    releaseName,
    releaseNotes,
    releaseUrl,
    assetName,
    statusMessage,
    lastError,
    progress,
    progressPercent,
    check,
    checkOnStartup,
    openUpdateCard,
    download,
    onProgress,
    closeModal,
  };
});
