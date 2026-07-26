<script setup lang="ts">
defineProps<{
  name:
    | "plus"
    | "folder"
    | "folderOpen"
    | "chevron"
    | "settings"
    | "terminal"
    | "preview"
    | "browser"
    | "chat"
    | "trash"
    | "spark"
    | "panelLeft"
    | "panelRight"
    | "send"
    | "stop"
    | "refresh"
    | "back"
    | "forward"
    | "cursor"
    | "search"
    | "diff";
  size?: number;
}>();
</script>

<template>
  <svg
    class="icon"
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </template>
    <template v-else-if="name === 'folderOpen'">
      <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h4" />
      <path d="M3 13h16l2 6H7z" />
    </template>
    <template v-else-if="name === 'chevron'">
      <path d="M9 6l6 6-6 6" />
    </template>
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </template>
    <template v-else-if="name === 'terminal'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </template>
    <template v-else-if="name === 'preview'">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </template>
    <template v-else-if="name === 'browser'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v5" />
    </template>
    <template v-else-if="name === 'chat'">
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0z" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </template>
    <template v-else-if="name === 'spark'">
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />
    </template>
    <template v-else-if="name === 'panelLeft'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </template>
    <template v-else-if="name === 'panelRight'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </template>
    <template v-else-if="name === 'send'">
      <path d="M5 12l14-7-7 14-2-5-5-2z" />
    </template>
    <template v-else-if="name === 'stop'">
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 4v6h-6" />
    </template>
    <template v-else-if="name === 'back'">
      <path d="M15 6l-6 6 6 6" />
    </template>
    <template v-else-if="name === 'forward'">
      <path d="M9 6l6 6-6 6" />
    </template>
    <template v-else-if="name === 'cursor'">
      <path d="M4 4l7 16 2-6 6-2L4 4z" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </template>
    <template v-else-if="name === 'diff'">
      <path d="M12 5v14M5 12h14" />
      <path d="M8 8h8M8 16h8" opacity="0" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8M9 12h6" />
    </template>
  </svg>
</template>

<style scoped>
.icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
