<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { NText } from "naive-ui";
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
  if (!props.state.turnStartedAt) return 0;
  return Math.max(0, now.value - props.state.turnStartedAt);
});
const silenceMs = computed(() => agentOutputSilenceMs(props.state as ChatState, now.value));
const workerSilenceMs = computed(() => agentWorkerSilenceMs(props.state as ChatState, now.value));

/** Local worker answered heartbeat recently during this turn. */
const workerAlive = computed(
  () =>
    Number.isFinite(workerSilenceMs.value) && workerSilenceMs.value < 20_000,
);

const phaseLabel = computed(() => {
  if (recovering.value) return t.autoRecovering;
  switch (phase.value) {
    case "starting":
      return t.agentWaitStarting;
    case "waiting_model":
      return t.agentWaitModel;
    case "thinking":
      return t.agentWaitThinking;
    case "writing":
      return t.agentWaitWriting;
    case "tool":
      return toolName.value ? t.agentWaitTool(toolName.value) : t.agentWaitToolGeneric;
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
  // Waiting on the user — no hang warning.
  if (phase.value === "waiting_user") {
    return elapsed;
  }
  if (silence >= 120_000 && !workerAlive.value) {
    return t.agentWaitLikelyStuck(formatElapsedShort(silence));
  }
  if (silence >= 30_000 && workerAlive.value) {
    return t.agentWaitSilentAlive(formatElapsedShort(silence), elapsed);
  }
  if (silence >= 45_000) {
    return t.agentWaitSilentUnknown(formatElapsedShort(silence), elapsed);
  }
  return elapsed;
});

const tone = computed<"ok" | "warn" | "danger">(() => {
  if (recovering.value) return "warn";
  if (phase.value === "waiting_user") return "ok";
  if (silenceMs.value >= 120_000 && !workerAlive.value) return "danger";
  if (silenceMs.value >= 30_000) return "warn";
  return "ok";
});
</script>

<template>
  <div class="agent-wait" :class="`tone-${tone}`">
    <span class="dot" />
    <NText depth="3" style="font-size: 12px">
      {{ phaseLabel }}
      <span v-if="detail" class="detail"> · {{ detail }}</span>
    </NText>
  </div>
</template>

<style scoped>
.agent-wait {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success, #18a058);
  animation: pulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}
.tone-warn .dot {
  background: var(--warning, #f0a020);
}
.tone-danger .dot {
  background: var(--error, #d03050);
  animation: none;
}
.detail {
  opacity: 0.85;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
