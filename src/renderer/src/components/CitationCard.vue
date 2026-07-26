<script setup lang="ts">
import { DocumentTextOutline, LinkOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import type { ComposerChip } from "@renderer/stores/composer";
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
    return hostPath.length > 32 ? `${hostPath.slice(0, 32)}…` : hostPath;
  } catch {
    return url.length > 32 ? `${url.slice(0, 32)}…` : url;
  }
}

function elementLabel(chip: Extract<ComposerChip, { kind: "element" }>): string {
  const text = chip.citation.text?.trim();
  if (text) return text.length > 28 ? `${text.slice(0, 28)}…` : text;
  const sel = chip.citation.selector?.trim();
  if (sel) return sel.length > 28 ? `${sel.slice(0, 28)}…` : sel;
  return t.chipElement;
}
</script>

<template>
  <div
    v-if="chip.kind === 'element'"
    class="cite-tag"
    :title="`${chip.citation.url}\n${chip.citation.selector}`"
  >
    <img
      v-if="chip.citation.screenshotDataUrl"
      class="thumb"
      :src="chip.citation.screenshotDataUrl"
      alt=""
    />
    <div class="meta">
      <span class="badge">{{ t.chipElement }}</span>
      <span class="text">{{ elementLabel(chip) }}</span>
    </div>
    <button type="button" class="x" title="移除" @click.stop="emit('remove')">×</button>
  </div>

  <div v-else-if="chip.kind === 'file'" class="cite-tag" :title="chip.path">
    <div class="icon-wrap">
      <NIcon :component="DocumentTextOutline" :size="14" />
    </div>
    <div class="meta">
      <span class="badge">{{ t.chipFile }}</span>
      <span class="text">{{ fileLabel(chip.path) }}</span>
    </div>
    <button type="button" class="x" title="移除" @click.stop="emit('remove')">×</button>
  </div>

  <div v-else class="cite-tag" :title="chip.url">
    <div class="icon-wrap">
      <NIcon :component="LinkOutline" :size="14" />
    </div>
    <div class="meta">
      <span class="badge">{{ t.chipUrl }}</span>
      <span class="text">{{ urlLabel(chip.url) }}</span>
    </div>
    <button type="button" class="x" title="移除" @click.stop="emit('remove')">×</button>
  </div>
</template>

<style scoped>
.cite-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 3px 6px 3px 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  font-size: 11.5px;
  line-height: 1.2;
}

.thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 5px;
  background: #fff;
  flex-shrink: 0;
  border: 1px solid var(--border);
}

.icon-wrap {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--bg-hover);
  color: var(--fg-muted);
  flex-shrink: 0;
}

.meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--fg-faint);
  letter-spacing: 0.02em;
}

.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-strong);
}

.x {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--fg-faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.x:hover {
  background: var(--bg-hover);
  color: var(--fg-strong);
}
</style>
