<script setup lang="ts"></script>

<template>
  <section class="chat-panel">
    <header class="head">Chat</header>
    <div class="body">
      <p class="stub">Agent conversation (stub)</p>
    </div>
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

.body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stub {
  margin: 0;
  font-size: 0.875rem;
  color: #6b7280;
}
</style>
