<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { ChevronDownOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import type {
  ProcessStep,
  TurnProcessStats,
} from "@renderer/utils/turn-process-summary";
import { formatTurnProcessView } from "@renderer/utils/turn-process-summary";
import { formatElapsedShort } from "@renderer/utils/agent-wait";
import { t } from "@renderer/i18n";

const props = defineProps<{
  stats: TurnProcessStats;
  steps?: ProcessStep[];
  /** Stable segment id — expand state lives on the parent (kite accordion). */
  segmentId: string;
  /** Controlled expand (parent owns kite / manual-open persistence). */
  expanded: boolean;
  /** Current/latest action line (always under the summary while live). */
  liveAction?: string | null;
}>();

const emit = defineEmits<{
  toggle: [segmentId: string];
}>();

const labels = {
  exploringFiles: t.processExploringFiles,
  exploredFiles: t.processExploredFiles,
  editingFiles: t.processEditingFiles,
  editedFiles: t.processEditedFiles,
  searches: t.processSearches,
  tools: t.processOtherTools,
  join: t.processSummarySep,
  thinking: t.thinkingStreaming,
  thoughtFor: t.processThoughtFor,
  thoughtBriefly: t.processThoughtBriefly,
  planning: t.processPlanning,
  formatDuration: formatElapsedShort,
};

const view = computed(() =>
  formatTurnProcessView(props.stats, labels, props.steps?.length ?? 0),
);

const showDiff = computed(
  () => props.stats.additions > 0 || props.stats.deletions > 0,
);

/** Stick the last non-empty live action so the line does not blink out between tools. */
const stickyLiveAction = ref<string | null>(null);

watch(
  () => [props.stats.live, props.liveAction, props.stats.thinkingStreaming] as const,
  ([live, action, thinkingStreaming]) => {
    if (!live) {
      stickyLiveAction.value = null;
      return;
    }
    if (thinkingStreaming) return;
    const next = action?.trim();
    if (next) stickyLiveAction.value = next;
  },
  { immediate: true },
);

const currentLine = computed(() => {
  if (!props.stats.live) return null;
  // Active thinking already uses the header as the live line.
  if (props.stats.thinkingStreaming) return null;
  return (
    props.liveAction?.trim() ||
    stickyLiveAction.value ||
    t.processPlanning
  );
});

function toggle(): void {
  if (!view.value.expandable) return;
  emit("toggle", props.segmentId);
}
</script>

<template>
  <div
    v-if="view.summary || currentLine"
    class="process-summary"
    :class="{ live: stats.live, open: expanded }"
  >
    <button
      v-if="view.summary"
      type="button"
      class="ps-head"
      :class="{ clickable: view.expandable }"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <span
        class="ps-summary"
        :class="{
          'chat-shimmer-text': stats.live && !currentLine,
        }"
      >{{ view.summary }}</span>
      <span v-if="showDiff" class="ps-diff">
        <span class="ps-add">+{{ stats.additions }}</span>
        <span class="ps-del">−{{ stats.deletions }}</span>
      </span>
      <NIcon
        v-if="view.expandable"
        class="ps-chev"
        :component="expanded ? ChevronDownOutline : ChevronForwardOutline"
        :size="12"
      />
    </button>

    <div v-if="expanded && steps?.length" class="ps-steps">
      <template v-for="step in steps" :key="step.id">
        <div class="ps-step" :class="{ 'has-nested': step.children?.length }">
          <span class="ps-verb">{{ step.verb }}</span>
          <span v-if="step.detail" class="ps-detail">{{ step.detail }}</span>
          <span v-if="step.additions != null || step.deletions != null" class="ps-diff">
            <span v-if="step.additions" class="ps-add">+{{ step.additions }}</span>
            <span v-if="step.deletions" class="ps-del">−{{ step.deletions }}</span>
          </span>
          <NIcon
            v-if="step.children?.length"
            class="ps-chev"
            :component="ChevronForwardOutline"
            :size="11"
          />
        </div>
        <div v-if="step.children?.length" class="ps-nested">
          <div
            v-for="child in step.children"
            :key="child.id"
            class="ps-step"
          >
            <span class="ps-verb">{{ child.verb }}</span>
            <span class="ps-detail">{{ child.detail }}</span>
            <span v-if="child.additions != null || child.deletions != null" class="ps-diff">
              <span v-if="child.additions" class="ps-add">+{{ child.additions }}</span>
              <span v-if="child.deletions" class="ps-del">−{{ child.deletions }}</span>
            </span>
          </div>
        </div>
      </template>
    </div>

    <div
      v-if="currentLine"
      class="ps-current chat-shimmer-text"
    >{{ currentLine }}</div>
  </div>
</template>

<style scoped>
.process-summary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  margin: 0 0 2px;
  padding: 0;
  border: none;
  background: transparent;
  font-family: var(--font-ui, inherit);
  font-size: 12.5px;
  line-height: 1.5;
}

.ps-head {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #5a6270;
  font: inherit;
  font-weight: 500;
  text-align: left;
  cursor: default;
}

.ps-head.clickable {
  cursor: pointer;
}

.ps-head.clickable:hover {
  color: #3a4150;
}

html[data-theme="dark"] .ps-head {
  color: #a0a8b8;
}

html[data-theme="dark"] .ps-head.clickable:hover {
  color: #d7dde8;
}

.ps-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ps-chev {
  flex-shrink: 0;
  opacity: 0.55;
  color: inherit;
}

.ps-diff {
  flex-shrink: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  font-size: 12px;
}

.ps-add {
  color: #2f6f44;
}

.ps-del {
  color: #a04848;
}

html[data-theme="dark"] .ps-add {
  color: #3fb950;
}

html[data-theme="dark"] .ps-del {
  color: #f85149;
}

.ps-steps {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  padding: 2px 0 2px 2px;
}

.ps-step {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  text-align: left;
  color: inherit;
  line-height: 1.45;
}

.ps-verb {
  flex-shrink: 0;
  color: #5f6775;
  font-weight: 500;
}

html[data-theme="dark"] .ps-verb {
  color: #9aa3b2;
}

.ps-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8b93a0;
  font-weight: 400;
}

html[data-theme="dark"] .ps-detail {
  color: #7d8590;
}

.ps-nested {
  display: flex;
  flex-direction: column;
  padding-left: 14px;
}

.ps-current {
  font-weight: 500;
  font-size: 12.5px;
  line-height: 1.5;
  color: #7a8494;
}

html[data-theme="dark"] .ps-current {
  color: #9aa3b2;
}
</style>
