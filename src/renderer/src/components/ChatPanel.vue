<script setup lang="ts">
import { computed, onMounted } from "vue";
import Composer from "@renderer/components/Composer.vue";
import MessageList from "@renderer/components/MessageList.vue";
import { useChatStore } from "@renderer/stores/chat";
import { useSessionsStore } from "@renderer/stores/sessions";

const chat = useChatStore();
const sessions = useSessionsStore();

onMounted(() => {
  chat.bindEvents();
});

const running = computed(() => {
  const id = sessions.activeId;
  if (!id) {
    return false;
  }
  const row = sessions.sessions.find((s) => s.id === id);
  return chat.activeRunning || row?.status === "running";
});
</script>

<template>
  <section class="chat-panel">
    <header class="head">Chat</header>
    <MessageList :messages="chat.activeMessages" :running="running" />
    <Composer />
  </section>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: #fff;
}

.head {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.8125rem;
  font-weight: 600;
}
</style>
