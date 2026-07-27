<script setup lang="ts">
import { onMounted } from "vue";
import { NButton, NEmpty, NIcon, NList, NListItem, NThing, NText } from "naive-ui";
import { FolderOpenOutline, FolderOutline } from "@vicons/ionicons5";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";
import logoUrl from "@renderer/assets/logo.svg";

const workspace = useWorkspaceStore();

onMounted(() => {
  void workspace.listRecent();
});

function openFolder(): void {
  void workspace.openWorkspace();
}

function openRecent(path: string): void {
  void workspace.openWorkspacePath(path);
}

function workspaceName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() ?? path;
}
</script>

<template>
  <section class="welcome">
    <div class="hero">
      <img class="logo" :src="logoUrl" alt="Pi Desktop" width="56" height="56" />
      <h1>{{ t.appName }}</h1>
      <NText depth="3">{{ t.openFolderHint }}</NText>
      <NButton type="primary" size="medium" style="margin-top: 12px" @click="openFolder">
        <template #icon>
          <NIcon :component="FolderOpenOutline" />
        </template>
        {{ t.openFolder }}
      </NButton>
    </div>

    <div v-if="workspace.recent.length" class="recent">
      <NText depth="3" style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em">
        {{ t.recent }}
      </NText>
      <NList hoverable clickable style="margin-top: 8px; border: 1px solid var(--border); border-radius: 12px">
        <NListItem v-for="item in workspace.recent" :key="item" @click="openRecent(item)">
          <NThing>
            <template #avatar>
              <NIcon :component="FolderOutline" :size="18" depth="3" />
            </template>
            <template #header>{{ workspaceName(item) }}</template>
            <template #description>
              <NText depth="3" style="font-size: 11px">{{ item }}</NText>
            </template>
          </NThing>
        </NListItem>
      </NList>
    </div>
    <NEmpty v-else :description="t.noRecentProjects" style="margin-top: 24px" />
  </section>
</template>

<style scoped>
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 36px;
  padding: 32px;
  background:
    radial-gradient(1200px 480px at 50% -10%, var(--accent-soft), transparent 60%),
    var(--bg);
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: block;
  margin-bottom: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}

.recent {
  width: min(420px, 100%);
}
</style>
