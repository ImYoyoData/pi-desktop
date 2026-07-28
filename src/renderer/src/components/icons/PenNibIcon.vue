<script setup lang="ts">
/**
 * Fountain-pen nib icon for element select (Cursor-like).
 */
withDefaults(
  defineProps<{
    size?: number;
  }>(),
  { size: 16 },
);
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- Flat ferrule -->
    <path d="M15 3h5v3" />
    <!-- Nib outline tipping bottom-left -->
    <path d="M20 6l-2 2 2 7-10 7-5-5 7-10 2-2" />
    <!-- Breather hole -->
    <circle cx="14" cy="12" r="1.35" />
    <!-- Tip slit -->
    <path d="M13 13.2L8.2 18" />
  </svg>
</template>
