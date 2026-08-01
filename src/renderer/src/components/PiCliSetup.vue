<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { NModal, NText, NButton, NSpace, NProgress, useMessage } from "naive-ui";
import { t } from "@renderer/i18n";
import type { PiCliInstallProgress, PiCliStatus } from "../../../shared/pi-cli";

const message = useMessage();
const open = ref(false);
const installing = ref(false);
const status = ref<PiCliStatus | null>(null);
const progress = ref<PiCliInstallProgress | null>(null);
let offProgress: (() => void) | undefined;

const platformLabel = computed(() => {
  const p = status.value?.platform;
  if (p === "darwin") return "macOS";
  if (p === "win32") return "Windows";
  if (p === "linux") return "Linux";
  return p ?? "";
});

const methodHint = computed(() => {
  const methods = status.value?.availableMethods ?? [];
  if (!methods.length) return t.piCliNoMethod;
  const preferred = status.value?.preferredMethod;
  return t.piCliMethodHint(methods.join(" → "), preferred ?? methods[0]!);
});

const progressPercent = computed(() => {
  const phase = progress.value?.phase;
  switch (phase) {
    case "detect":
      return 15;
    case "install":
      return 55;
    case "verify":
      return 85;
    case "done":
      return 100;
    case "error":
      return 100;
    default:
      return installing.value ? 30 : 0;
  }
});

async function checkPrompt(): Promise<void> {
  try {
    if (!window.api?.piCli?.shouldPrompt) return;
    const result = await window.api.piCli.shouldPrompt();
    status.value = result.status;
    open.value = result.prompt;
  } catch {
    // ignore probe failures on startup — never block the app shell
  }
}

async function onInstall(): Promise<void> {
  if (installing.value) return;
  installing.value = true;
  progress.value = { phase: "detect", method: null, message: t.piCliInstalling };
  try {
    const result = await window.api.piCli.install();
    status.value = result.status;
    if (result.ok) {
      if (result.status.installed) {
        message.success(t.piCliInstallOk, { duration: 3500 });
      } else if (result.openedExternal) {
        message.info(t.piCliInstallStarted, { duration: 7000 });
      } else {
        message.info(t.piCliInstallNeedRestart, { duration: 7000 });
      }
      open.value = false;
    } else {
      message.error(result.error || t.piCliInstallFail, { duration: 7000 });
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : t.piCliInstallFail, { duration: 7000 });
  } finally {
    installing.value = false;
  }
}

async function onSkip(): Promise<void> {
  await window.api.piCli.skip();
  open.value = false;
}

async function onOpenSite(): Promise<void> {
  await window.api.piCli.openSite();
}

async function onOpenDocs(): Promise<void> {
  await window.api.piCli.openDocs();
}

onMounted(() => {
  offProgress = window.api.piCli.onProgress((p) => {
    progress.value = p;
  });
  // Defer CLI probe so it never contends with first paint / workspace restore.
  window.setTimeout(() => {
    void checkPrompt();
  }, 1500);
});

onUnmounted(() => {
  offProgress?.();
});
</script>

<template>
  <NModal
    :show="open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(480px, 92vw)"
    :title="t.piCliMissingTitle"
    :bordered="false"
    :mask-closable="!installing"
    :closable="!installing"
    size="huge"
    @update:show="(v) =>
    
 !installing && !v && onSkip()"
  >
    <div class="modal-scroll">

    <NText depth="3" style="font-size: 13px; display: block; line-height: 1.55">
      {{ t.piCliMissingBody(platformLabel) }}
    </NText>
    <NText depth="3" style="font-size: 12px; display: block; margin-top: 10px; line-height: 1.5">
      {{ methodHint }}
    </NText>
    <NText depth="3" style="font-size: 12px; display: block; margin-top: 8px">
      {{ t.piCliDocsHint }}
      <button type="button" class="link" @click="onOpenSite">pi.dev</button>
      ·
      <button type="button" class="link" @click="onOpenDocs">{{ t.piCliOpenDocs }}</button>
    </NText>

    <div v-if="installing || progress" class="progress">
      <NText style="font-size: 12px">{{ progress?.message || t.piCliInstalling }}</NText>
      <NProgress
        type="line"
        :percentage="progressPercent"
        :status="progress?.phase === 'error' ? 'error' : 'default'"
        :show-indicator="false"
        style="margin-top: 8px"
      />
    </div>

    
    

    </div>
<template #footer>
      <div class="footer">
        <NButton :disabled="installing" @click="onSkip">{{ t.piCliSkip }}</NButton>
        <NSpace :size="8">
          <NButton :disabled="installing" @click="onOpenSite">{{ t.piCliOpenSite }}</NButton>
          <NButton type="primary" :loading="installing" @click="onInstall">
            {{ t.piCliInstall }}
          </NButton>
        </NSpace>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.progress {
  margin-top: 16px;
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.link {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--fg-strong);
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
