<script setup lang="ts">
import { NTag } from "naive-ui";
import type { ComposerChip } from "@renderer/stores/composer";
import { truncateElementContent } from "@renderer/stores/composer";
import { fileTagLabel } from "@renderer/utils/composer-tags";
import { t } from "@renderer/i18n";

defineProps<{
  chip: ComposerChip;
}>();

const emit = defineEmits<{
  remove: [];
}>();

function urlLabel(url: string): string {
  try {
    const u = new URL(url);
    const hostPath = `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
    return hostPath.length > 40 ? `${hostPath.slice(0, 40)}…` : hostPath;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}

/** Content-only label for element tags (max 100 chars). */
function elementLabel(chip: Extract<ComposerChip, { kind: "element" }>): string {
  const content = truncateElementContent(chip.citation.text ?? "", 100);
  if (content) return content;
  const sel = chip.citation.selector?.trim();
  if (sel) {
    const last = sel.split(">").pop()?.trim() || sel;
    return last.length > 36 ? `${last.slice(0, 36)}…` : last;
  }
  return t.chipElement;
}

function elementTitle(chip: Extract<ComposerChip, { kind: "element" }>): string {
  return [chip.citation.url, chip.citation.selector, chip.citation.text].filter(Boolean).join("\n");
}
</script>

<template>
  <!-- File tags show workspace-relative path (not basename-only). -->
  <NTag
    v-if="chip.kind === 'file'"
    type="info"
    size="small"
    closable
    round
    class="chip-tag chip-file"
    :title="chip.path"
    @close="emit('remove')"
  >
    {{ fileTagLabel(chip.path) }}
  </NTag>

  <NTag
    v-else-if="chip.kind === 'element'"
    type="info"
    size="small"
    closable
    round
    class="chip-tag"
    :title="elementTitle(chip)"
    @close="emit('remove')"
  >
    {{ elementLabel(chip) }}
  </NTag>

  <NTag
    v-else
    type="info"
    size="small"
    closable
    round
    class="chip-tag"
    :title="chip.url"
    @close="emit('remove')"
  >
    {{ urlLabel(chip.url) }}
  </NTag>
</template>

<style scoped>
.chip-tag {
  max-width: min(420px, 70vw);
  flex-shrink: 0;
}

.chip-file {
  font-family: var(--font-mono);
  font-size: 11px;
}

.chip-tag :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
