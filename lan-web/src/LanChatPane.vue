<script setup lang="ts">
import { computed, watch } from "vue";
import {
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  darkTheme,
  type GlobalThemeOverrides,
} from "naive-ui";
import MessageList from "@renderer/components/MessageList.vue";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";

const props = defineProps<{
  dark: boolean;
  sessionId: string | null;
}>();

const chat = useChatStore();
const sessions = useSessionsStore();

watch(
  () => props.sessionId,
  (id) => {
    sessions.activeId = id;
  },
  { immediate: true },
);

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#4176e6",
    primaryColorHover: "#5686fe",
    primaryColorPressed: "#4176e6",
    borderRadius: "10px",
  },
};

const messages = computed(() => {
  const id = props.sessionId;
  if (!id) return [];
  return chat.bySession[id]?.messages ?? [];
});
const streaming = computed(() => {
  const id = props.sessionId;
  if (!id) return null;
  return chat.bySession[id]?.streamingMessage ?? null;
});
const running = computed(() => {
  const id = props.sessionId;
  if (!id) return false;
  return Boolean(chat.bySession[id]?.running);
});
const retryHint = computed(() => {
  const id = props.sessionId;
  if (!id) return null;
  return chat.bySession[id]?.retryHint ?? null;
});
const historyLoading = computed(
  () => props.sessionId != null && chat.historyLoadingId === props.sessionId,
);
const historyHasMore = computed(() => Boolean(chat.historyHasMore));
</script>

<template>
  <NConfigProvider
    :theme="dark ? darkTheme : null"
    :theme-overrides="themeOverrides"
    class="lan-chat-pane"
  >
    <NMessageProvider>
      <NDialogProvider>
        <MessageList
          :messages="messages"
          :streaming="streaming"
          :running="running"
          :retry-hint="retryHint"
          :history-loading="historyLoading"
          :history-has-more="historyHasMore"
          :history-loading-older="false"
        />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.lan-chat-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
}
</style>
