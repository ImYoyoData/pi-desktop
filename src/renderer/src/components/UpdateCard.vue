<script setup lang="ts">
import { computed } from "vue";
import { NButton, NModal, NProgress, NSpace, NText, useMessage } from "naive-ui";
import MarkdownView from "@renderer/components/MarkdownView.vue";
import { useUpdateStore } from "@renderer/stores/update";
import { t } from "@renderer/i18n";

const update = useUpdateStore();
const message = useMessage();

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const title = computed(() => {
  if (update.available && update.latestVersion) {
    return t.updateAvailableTitle(update.latestVersion);
  }
  if (update.checking) return t.checkingUpdate;
  return t.checkUpdate;
});

const versionLine = computed(() => {
  const cur = update.currentVersion ? `v${update.currentVersion}` : "—";
  const latest = update.latestVersion ? `v${update.latestVersion}` : "—";
  return t.updateVersionLine(cur, latest);
});

async function onDownload(): Promise<void> {
  const result = await update.download();
  if (!result) return;
  if (result.status === "downloaded") {
    message.success(t.updateDownloaded, { duration: 5000 });
  } else if (result.status === "openedBrowser") {
    message.info(result.message, { duration: 5000 });
  } else if (result.status === "error") {
    message.error(result.message, { duration: 5000 });
  } else if (result.status === "upToDate") {
    message.success(result.message, { duration: 3000 });
  }
}

async function onOpenRelease(): Promise<void> {
  if (update.releaseUrl) {
    await window.api.browser.openExternal(update.releaseUrl);
  } else {
    await window.api.update.openReleases();
  }
}

async function onRefresh(): Promise<void> {
  await update.check({ openModal: true });
}
</script>

<template>
  <NModal
    :show="update.modalOpen"
    preset="card"
    class="pi-settings-modal"
    style="width: min(520px, 94vw)"
    :title="title"
    :bordered="false"
    size="huge"
    @update:show="(v: boolean) =>
    
 !v && update.closeModal()"
  >
    <div class="modal-scroll">

    <div class="body">
      <div class="version-line">{{ versionLine }}</div>
      <div v-if="update.releaseName" class="release-name">{{ update.releaseName }}</div>

      <NText v-if="update.checking" depth="3" style="font-size: 13px">
        {{ t.checkingUpdate }}
      </NText>

      <template v-else-if="update.available">
        <div class="notes-label">{{ t.updateNotes }}</div>
        <div class="notes">
          <MarkdownView v-if="update.releaseNotes" :content="update.releaseNotes" />
          <NText v-else depth="3" style="font-size: 13px">{{ t.updateNoNotes }}</NText>
        </div>

        <div v-if="update.downloading || update.progress" class="progress-block">
          <div class="progress-msg">
            {{ update.progress?.message || t.updateDownloading }}
          </div>
          <NProgress
            type="line"
            :percentage="update.progressPercent ?? (update.downloading ? 0 : 100)"
            indicator-placement="inside"
            :processing="update.downloading && update.progressPercent == null"
            :status="
              update.progress?.phase === 'error'
                ? 'error'
                : update.progress?.phase === 'done'
                  ? 'success'
                  : 'default'
            "
          />
          <div v-if="update.progress?.totalBytes" class="progress-bytes">
            {{ formatBytes(update.progress.receivedBytes) }}
            /
            {{ formatBytes(update.progress.totalBytes) }}
          </div>
        </div>
      </template>

      <template v-else-if="update.lastError">
        <NText type="error" style="font-size: 13px">{{ update.lastError }}</NText>
      </template>

      <template v-else>
        <NText depth="3" style="font-size: 13px">
          {{ update.statusMessage || t.updateUpToDate }}
        </NText>
      </template>
    </div>

    
    

    </div>
<template #footer>
      <NSpace justify="space-between" style="width: 100%">
        <NButton quaternary :disabled="update.busy" @click="onRefresh">
          {{ t.updateRecheck }}
        </NButton>
        <NSpace>
          <NButton @click="update.closeModal()">{{ t.close }}</NButton>
          <NButton secondary :disabled="update.busy" @click="onOpenRelease">
            {{ t.updateOpenRelease }}
          </NButton>
          <NButton
            v-if="update.available"
            type="primary"
            :loading="update.downloading"
            :disabled="update.checking"
            @click="onDownload"
          >
            {{ t.updateDownload }}
          </NButton>
        </NSpace>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 80px;
}

.version-line {
  font-size: 13px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.release-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-strong);
}

.notes-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.notes {
  max-height: 280px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated, var(--bg));
  font-size: 13px;
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.progress-msg {
  font-size: 12px;
  color: var(--fg-muted);
}

.progress-bytes {
  font-size: 11px;
  color: var(--fg-faint, var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
</style>
