<script setup lang="ts">
import { computed } from "vue";
import { NProgress, NText } from "naive-ui";
import { useAsrStore } from "@renderer/stores/asr";
import { t } from "@renderer/i18n";

const asr = useAsrStore();

function formatMb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0";
  return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1);
}

const phaseLabel = computed(() => {
  const phase = asr.progress?.phase;
  switch (phase) {
    case "binary":
      return t.asrProgressBinary;
    case "model":
      return t.asrProgressModel;
    case "extract":
      return t.asrProgressExtract;
    case "done":
      return t.asrInstallOk;
    case "error":
      return asr.progress?.message || t.asrFail;
    case undefined:
      return t.asrProgressStarting;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
});

const percentage = computed(() => {
  const p = asr.progress;
  if (!p) return 0;
  if (p.phase === "done") return 100;
  if (p.phase === "extract") return 100;
  if (p.phase === "error") return 0;
  const total = p.totalBytes ?? 0;
  if (total <= 0) return 0;
  return Math.min(99, Math.max(0, Math.round((p.receivedBytes / total) * 100)));
});

const detail = computed(() => {
  const p = asr.progress;
  if (!p) return "";
  if (p.phase === "extract" || p.phase === "done" || p.phase === "error") return "";
  const total = p.totalBytes ?? 0;
  if (total > 0) {
    return `${formatMb(p.receivedBytes)} / ${formatMb(total)} MB`;
  }
  return `${formatMb(p.receivedBytes)} MB`;
});

const processing = computed(
  () => asr.status.busy && asr.progress?.phase !== "done" && asr.progress?.phase !== "error",
);
</script>

<template>
  <div class="asr-progress">
    <div class="asr-progress-head">
      <NText style="font-size: 13px">{{ phaseLabel }}</NText>
      <NText v-if="detail" depth="3" style="font-size: 12px">{{ detail }}</NText>
    </div>
    <NProgress
      type="line"
      :percentage="percentage"
      :processing="processing"
      :status="asr.progress?.phase === 'error' ? 'error' : 'default'"
      :show-indicator="true"
      style="margin-top: 8px"
    />
  </div>
</template>

<style scoped>
.asr-progress {
  width: 100%;
}
.asr-progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
</style>
