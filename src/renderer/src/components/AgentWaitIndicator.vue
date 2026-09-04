<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { ChatState } from "@renderer/stores/chat-reducer";
import {
  agentOutputSilenceMs,
  agentWaitPhase,
  agentWaitToolName,
  agentWorkerSilenceMs,
  formatElapsedShort,
} from "@renderer/utils/agent-wait";
import { t } from "@renderer/i18n";

const props = defineProps<{
  state: Pick<
    ChatState,
    | "running"
    | "streamingMessage"
    | "retryHint"
    | "pendingAskUser"
    | "pendingPermission"
    | "pendingExtensionUi"
    | "turnStartedAt"
    | "phaseStartedAt"
    | "lastActivityAt"
    | "lastWorkerAliveAt"
  > & {
    autoRecovering?: boolean;
  };
}>();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  timer = null;
});

const recovering = computed(() => Boolean(props.state.autoRecovering));

const phase = computed(() =>
  recovering.value ? null : agentWaitPhase(props.state as ChatState),
);
const toolName = computed(() => agentWaitToolName(props.state as ChatState));
const elapsedMs = computed(() => {
  const started = props.state.phaseStartedAt ?? props.state.turnStartedAt;
  if (!started) return 0;
  return Math.max(0, now.value - started);
});
const silenceMs = computed(() => agentOutputSilenceMs(props.state as ChatState, now.value));
const workerSilenceMs = computed(() => agentWorkerSilenceMs(props.state as ChatState, now.value));

const workerAlive = computed(
  () =>
    Number.isFinite(workerSilenceMs.value) && workerSilenceMs.value < 20_000,
);

/** Primary shimmer line — Cursor-style status, no dump. */
const shimmerLabel = computed(() => {
  if (recovering.value) return t.autoRecovering;
  switch (phase.value) {
    case "starting":
      return t.agentWaitStarting;
    case "waiting_model":
      return t.agentWaitModel;
    case "thinking":
      return t.thinkingStreaming;
    case "writing":
      return t.agentWaitWriting;
    case "tool":
      return toolName.value ? t.toolsRunningHint(toolName.value) : t.toolsRunning;
    case "waiting_user":
      return t.agentWaitUser;
    case null:
      return t.agentRunning;
    default: {
      const _exhaustive: never = phase.value;
      return _exhaustive;
    }
  }
});

const detail = computed(() => {
  if (recovering.value) return "";
  const elapsed = formatElapsedShort(elapsedMs.value);
  const silence = silenceMs.value;
  if (phase.value === "waiting_user") return elapsed;
  if (silence >= 120_000 && !workerAlive.value) {
    return t.agentWaitLikelyStuck(formatElapsedShort(silence));
  }
  if (silence >= 30_000 && workerAlive.value) {
    return t.agentWaitSilentAlive(formatElapsedShort(silence), elapsed);
  }
  if (silence >= 45_000) {
    return t.agentWaitSilentUnknown(formatElapsedShort(silence), elapsed);
  }
  return "";
});

const tone = computed<"ok" | "warn" | "danger">(() => {
  if (recovering.value) return "warn";
  if (phase.value === "waiting_user") return "ok";
  if (silenceMs.value >= 120_000 && !workerAlive.value) return "danger";
  if (silenceMs.value >= 30_000) return "warn";
  return "ok";
});

const useShimmer = computed(() => tone.value === "ok" && !recovering.value);
</script>

<template>
  <div class="agent-wait" :class="`tone-${tone}`">
    <div class="wait-head">
      <span :class="useShimmer ? 'chat-shimmer-text' : 'plain-label'">{{
        shimmerLabel
      }}</span>
    </div>
    <div v-if="detail" class="wait-detail">{{ detail }}</div>
  </div>
</template>

<style scoped>
/* Cursor wait: plain shimmer text — no rail / chevron / card. */
.agent-wait {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 0;
  padding: 2px 0;
  border: none;
  font-family: var(--font-ui, inherit);
  font-size: 13px;
  box-sizing: border-box;
}

.wait-head {
  display: flex;
  align-items: center;
  min-height: 22px;
  min-width: 0;
}

.plain-label {
  font-weight: 500;
  color: var(--fg-muted);
}

.wait-detail {
  margin: 0;
  padding: 0;
  border: none;
  color: var(--fg-faint, #8a94aa);
  font-size: 12px;
  line-height: 1.4;
}

.tone-warn .plain-label,
.tone-warn .wait-detail {
  color: var(--warning, #c9902c);
}

.tone-danger .plain-label,
.tone-danger .wait-detail {
  color: var(--error, #d03050);
}
</style>
