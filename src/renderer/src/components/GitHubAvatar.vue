<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { HardwareChipOutline } from "@vicons/ionicons5";
import { avatarUrlOf, isBotLogin, loadGithubImage } from "@renderer/utils/github-image";

const props = withDefaults(
  defineProps<{
    login: string;
    src?: string;
    avatars?: Record<string, string>;
    size?: "sm" | "md" | "lg";
  }>(),
  { src: "", avatars: () => ({}), size: "md" },
);

const dataUrl = ref<string | null>(null);
const failed = ref(false);

const url = computed(() => avatarUrlOf(props.login, props.avatars, props.src));
const bot = computed(() => isBotLogin(props.login));

async function load(next: string): Promise<void> {
  failed.value = false;
  dataUrl.value = null;
  if (!next) {
    failed.value = true;
    return;
  }
  const loaded = await loadGithubImage(next);
  if (url.value !== next) return;
  dataUrl.value = loaded;
  failed.value = loaded === null;
}

watch(url, (next) => void load(next), { immediate: true });
</script>

<template>
  <span
    class="gh-avatar"
    :class="[size, bot ? 'bot' : 'round']"
    :title="login"
    aria-hidden="true"
  >
    <img v-if="dataUrl" :src="dataUrl" alt="" />
    <NIcon v-else-if="bot" :component="HardwareChipOutline" class="bot-icon" />
    <span v-else-if="failed" class="initial">{{ login.slice(0, 1).toUpperCase() }}</span>
    <span v-else class="loading" />
  </span>
</template>

<style scoped>
.gh-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.14);
  color: var(--fg-muted);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
}

.gh-avatar.round {
  border-radius: 50%;
}

.gh-avatar.bot {
  border-radius: 6px;
}

.gh-avatar.sm {
  width: 16px;
  height: 16px;
}

.gh-avatar.md {
  width: 20px;
  height: 20px;
}

.gh-avatar.lg {
  width: 28px;
  height: 28px;
}

.gh-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bot-icon {
  width: 70%;
  height: 70%;
}

.loading {
  width: 60%;
  height: 60%;
  border-radius: 50%;
  background: rgba(127, 127, 127, 0.2);
}
</style>
