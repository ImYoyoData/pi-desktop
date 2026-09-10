<script setup lang="ts">
/**
 * Brand badge for a model provider.
 *
 * Renders the platform's real logo (bundled offline via
 * `shared/provider-brand-icons`) inside a brand-coloured tile. Providers we have
 * no mark for fall back to the original letter chip, so nothing regresses.
 */
import { computed } from "vue";
import { brandGlyph, resolveBrandVisual } from "../../../shared/provider-brand-icons";

const props = withDefaults(
  defineProps<{
    provider: string;
    size?: number;
    /** `tile` = coloured rounded square (default); `plain` = bare glyph. */
    variant?: "tile" | "plain";
    /** Colour for the `plain` variant; defaults to `currentColor`. */
    color?: string;
  }>(),
  { size: 22, variant: "tile" },
);

const brand = computed(() => resolveBrandVisual(props.provider));

const glyph = computed(() => (brand.value ? brandGlyph(brand.value.glyph) : null));

const letter = computed(() => {
  const raw = props.provider.replace(/^[^a-z0-9]+/iu, "").trim();
  return (raw[0] ?? "?").toUpperCase();
});

/** Glyphs are drawn at ~72% of the tile so the mark breathes. */
const glyphSize = computed(() => Math.round(props.size * 0.72));

const tileStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${Math.max(5, Math.round(props.size * 0.28))}px`,
  background: props.variant === "plain" ? "transparent" : (brand.value?.bg ?? "var(--bg-hover)"),
  color: props.variant === "plain" ? (props.color ?? "currentColor") : (brand.value?.fg ?? "var(--fg-muted)"),
  fontSize: `${Math.max(9, props.size * 0.42)}px`,
}));
</script>

<template>
  <span class="provider-icon" :style="tileStyle" :title="provider">
    <svg
      v-if="glyph"
      class="glyph"
      :viewBox="glyph.viewBox"
      :width="variant === 'plain' ? size : glyphSize"
      :height="variant === 'plain' ? size : glyphSize"
      fill="currentColor"
      fill-rule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <g v-if="glyph.transform" :transform="glyph.transform">
        <path v-for="(p, i) in glyph.paths" :key="i" :d="p.d" :fill="p.fill" />
      </g>
      <template v-else>
        <path v-for="(p, i) in glyph.paths" :key="i" :d="p.d" :fill="p.fill" />
      </template>
    </svg>
    <template v-else>{{ letter }}</template>
  </span>
</template>

<style scoped>
.provider-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow: hidden;
}

.glyph {
  display: block;
}
</style>
