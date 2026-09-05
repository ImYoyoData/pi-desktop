<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    path?: string;
    size?: number;
  }>(),
  { size: 12 },
);

type ExtStyle = { color: string; label: string };

const EXT_STYLES: Record<string, ExtStyle> = {
  ts: { color: "#3178c6", label: "TS" },
  tsx: { color: "#3178c6", label: "TS" },
  mts: { color: "#3178c6", label: "TS" },
  cts: { color: "#3178c6", label: "TS" },
  js: { color: "#cbcb41", label: "JS" },
  jsx: { color: "#cbcb41", label: "JS" },
  mjs: { color: "#cbcb41", label: "JS" },
  cjs: { color: "#cbcb41", label: "JS" },
  vue: { color: "#41b883", label: "V" },
  svelte: { color: "#ff3e00", label: "S" },
  css: { color: "#519aba", label: "#" },
  scss: { color: "#c6538c", label: "#" },
  sass: { color: "#c6538c", label: "#" },
  less: { color: "#2965f1", label: "#" },
  html: { color: "#e34c26", label: "<>" },
  json: { color: "#cbcb41", label: "{}" },
  json5: { color: "#cbcb41", label: "{}" },
  md: { color: "#519aba", label: "M↓" },
  markdown: { color: "#519aba", label: "M↓" },
  py: { color: "#3572a5", label: "Py" },
  go: { color: "#00add8", label: "Go" },
  rs: { color: "#dea584", label: "Rs" },
  java: { color: "#b07219", label: "J" },
  kt: { color: "#a97bff", label: "Kt" },
  c: { color: "#a8b9cc", label: "C" },
  h: { color: "#a8b9cc", label: "H" },
  cpp: { color: "#f34b7d", label: "C++" },
  cs: { color: "#178600", label: "C#" },
  rb: { color: "#701516", label: "Rb" },
  php: { color: "#4f5d95", label: "Php" },
  swift: { color: "#f05138", label: "Sw" },
  sh: { color: "#89e051", label: ">_" },
  bash: { color: "#89e051", label: ">_" },
  zsh: { color: "#89e051", label: ">_" },
  ps1: { color: "#4273c8", label: ">_" },
  yml: { color: "#cb171e", label: "Y" },
  yaml: { color: "#cb171e", label: "Y" },
  toml: { color: "#9c4221", label: "T" },
  xml: { color: "#e37933", label: "<>" },
  svg: { color: "#ffb13b", label: "◆" },
  sql: { color: "#e38c00", label: "DB" },
  lua: { color: "#000080", label: "Lua" },
  lock: { color: "#6d8086", label: "🔒" },
  env: { color: "#6d8086", label: ".ε" },
};

const ext = computed(() => {
  const p = props.path ?? "";
  const base = p.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
});

const style = computed<ExtStyle | null>(() => EXT_STYLES[ext.value] ?? null);

const isDir = computed(() => {
  const p = props.path ?? "";
  return p.endsWith("/") || p.endsWith("\\");
});
</script>

<template>
  <span
    class="file-type-icon"
    :class="{ generic: !style }"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.max(7, Math.round(size * 0.58))}px`,
      background: style ? style.color : 'transparent',
    }"
    aria-hidden="true"
  >
    <svg
      v-if="!style"
      :width="size"
      :height="size"
      viewBox="0 0 16 16"
      fill="none"
      class="file-type-glyph"
    >
      <path
        v-if="isDir"
        d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.6h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V3.5Z"
        fill="#8a9199"
      />
      <path
        v-else
        d="M3.5 1.5h5.6l3.4 3.4v9.6h-9V1.5Z"
        fill="#8a9199"
      />
    </svg>
    <template v-else>{{ style.label }}</template>
  </span>
</template>

<style scoped>
.file-type-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: #fff;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  overflow: hidden;
  user-select: none;
  white-space: nowrap;
}

.file-type-icon.generic {
  background: transparent;
}
</style>
