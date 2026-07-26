<script setup lang="ts">
import { NTag } from "naive-ui";
import type { ComposerChip } from "@renderer/stores/composer";
import { truncateElementContent } from "@renderer/stores/composer";
import { t } from "@renderer/i18n";

defineProps<{
  chip: ComposerChip;
}>();

const emit = defineEmits<{
  remove: [];
}>();

function fileLabel(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1] || path;
  return name.length > 28 ? `${name.slice(0, 28)}…` : name;
}

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
  <!-- Naive default blue (info) tag — no thumbnail; screenshot is a separate image chip -->
  <NTag
    v-if="chip.kind === 'element'"
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
    v-else-if="chip.kind === 'file'"
    type="info"
    size="small"
    closable
    round
    class="chip-tag"
    :title="chip.path"
    @close="emit('remove')"
  >
    {{ fileLabel(chip.path) }}
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
  max-width: 240px;
  flex-shrink: 0;
}

.chip-tag :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
