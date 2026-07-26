<script setup lang="ts">
/** Lightweight provider badges inspired by pi-web ModelsConfig (no @lobehub/icons dep). */
const props = defineProps<{
  provider: string;
  size?: number;
}>();

const meta: Record<string, { label: string; bg: string; fg: string }> = {
  anthropic: { label: "A", bg: "#d4a574", fg: "#1a1a1a" },
  openai: { label: "O", bg: "#10a37f", fg: "#fff" },
  "openai-codex": { label: "O", bg: "#10a37f", fg: "#fff" },
  google: { label: "G", bg: "#4285f4", fg: "#fff" },
  "google-vertex": { label: "G", bg: "#4285f4", fg: "#fff" },
  deepseek: { label: "D", bg: "#4d6bfe", fg: "#fff" },
  groq: { label: "q", bg: "#f55036", fg: "#fff" },
  mistral: { label: "M", bg: "#ff7000", fg: "#fff" },
  moonshot: { label: "K", bg: "#1a1a1a", fg: "#fff" },
  moonshotai: { label: "K", bg: "#1a1a1a", fg: "#fff" },
  "moonshotai-cn": { label: "K", bg: "#1a1a1a", fg: "#fff" },
  openrouter: { label: "R", bg: "#ababab", fg: "#111" },
  xai: { label: "x", bg: "#111", fg: "#fff" },
  xiaomi: { label: "米", bg: "#ff6900", fg: "#fff" },
  "xiaomi-token-plan-cn": { label: "米", bg: "#ff6900", fg: "#fff" },
  "xiaomi-token-plan-ams": { label: "米", bg: "#ff6900", fg: "#fff" },
  "xiaomi-token-plan-sgp": { label: "米", bg: "#ff6900", fg: "#fff" },
  zhipu: { label: "智", bg: "#0f62fe", fg: "#fff" },
  zai: { label: "Z", bg: "#111", fg: "#fff" },
  "zai-coding-cn": { label: "Z", bg: "#111", fg: "#fff" },
  qwen: { label: "Q", bg: "#615ced", fg: "#fff" },
  minimax: { label: "m", bg: "#e01616", fg: "#fff" },
  "minimax-cn": { label: "m", bg: "#e01616", fg: "#fff" },
  "github-copilot": { label: "GH", bg: "#24292f", fg: "#fff" },
  "azure-openai-responses": { label: "Az", bg: "#0078d4", fg: "#fff" },
  "amazon-bedrock": { label: "AWS", bg: "#ff9900", fg: "#111" },
};

const resolved = (() => {
  const key = props.provider.toLowerCase();
  if (meta[key]) return meta[key];
  const hit = Object.keys(meta).find((k) => key.includes(k) || k.includes(key));
  if (hit) return meta[hit];
  const ch = (props.provider[0] ?? "?").toUpperCase();
  return { label: ch, bg: "#e5e5e5", fg: "#333" };
})();
</script>

<template>
  <span
    class="provider-icon"
    :style="{
      width: `${size ?? 22}px`,
      height: `${size ?? 22}px`,
      background: resolved.bg,
      color: resolved.fg,
      fontSize: `${Math.max(10, (size ?? 22) * 0.42)}px`,
    }"
    :title="provider"
  >
    {{ resolved.label }}
  </span>
</template>

<style scoped>
.provider-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-weight: 700;
  flex-shrink: 0;
  line-height: 1;
  letter-spacing: -0.02em;
}
</style>
