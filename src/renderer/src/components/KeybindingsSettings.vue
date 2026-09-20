<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { NButton, NDivider, NText } from "naive-ui";
import ToggleButton from "@renderer/components/ToggleButton.vue";
import {
  BUILTIN_SHORTCUTS,
  KEYBINDINGS,
  useKeybindingsStore,
  type BuiltinShortcutGroup,
  type KeybindingId,
} from "@renderer/stores/keybindings";
import { keyboardEventToAccelerator } from "../../../shared/hotkey";
import { t, type Messages } from "@renderer/i18n";

const keybindings = useKeybindingsStore();
const recording = ref<KeybindingId | null>(null);

const BUILTIN_GROUP_TITLE: Record<BuiltinShortcutGroup, keyof Messages> = {
  app: "keybindingsBuiltinApp",
  composer: "keybindingsBuiltinComposer",
  menu: "keybindingsBuiltinMenu",
};

const builtinSections = computed(() =>
  (Object.keys(BUILTIN_GROUP_TITLE) as BuiltinShortcutGroup[]).map((group) => ({
    group,
    title: t[BUILTIN_GROUP_TITLE[group]],
    items: BUILTIN_SHORTCUTS.filter((item) => item.group === group),
  })),
);

const masterOn = computed({
  get: () => keybindings.master,
  set: (value: boolean) => keybindings.setMaster(value),
});

function startRecording(id: KeybindingId): void {
  recording.value = id;
  keybindings.setCapturing(true);
}

function stopRecording(): void {
  recording.value = null;
  keybindings.setCapturing(false);
}

/** 录制改键：Esc 取消，只按修饰键时继续等待。 */
function onRecordKeydown(event: KeyboardEvent): void {
  if (!recording.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    stopRecording();
    return;
  }
  const accel = keyboardEventToAccelerator(event);
  if (!accel) return;
  if (keybindings.setAccel(recording.value, accel)) stopRecording();
}

onMounted(() => window.addEventListener("keydown", onRecordKeydown, true));

onUnmounted(() => {
  window.removeEventListener("keydown", onRecordKeydown, true);
  keybindings.setCapturing(false);
});

function hintOf(id: KeybindingId): string {
  return keybindings.conflicts.has(id) ? t.keybindingsConflict : "";
}
</script>

<template>
  <div class="keys-panel">
    <div class="switch-row">
      <div class="labels">
        <NText strong>{{ t.keybindingsMaster }}</NText>
        <NText depth="3" class="hint">{{ t.keybindingsMasterHint }}</NText>
      </div>
      <ToggleButton v-model:value="masterOn" />
    </div>

    <NDivider class="divider" />

    <section class="group">
      <NText strong>{{ t.keybindingsCustomGroup }}</NText>
      <div class="rows">
        <div
          v-for="def in KEYBINDINGS"
          :key="def.id"
          class="row"
          :class="{ off: !keybindings.enabledOf(def.id) || !keybindings.master }"
        >
          <span class="label">{{ t[def.labelKey] }}</span>
          <span
            class="keys"
            :class="{ recording: recording === def.id, conflict: keybindings.conflicts.has(def.id) }"
            :title="recording === def.id ? t.keybindingsRecordingHint : hintOf(def.id)"
          >
            {{ recording === def.id ? t.keybindingsRecording : keybindings.labelOf(def) || t.keybindingsUnset }}
          </span>
          <NButton
            size="tiny"
            quaternary
            :disabled="recording === def.id || !keybindings.master"
            @click="startRecording(def.id)"
          >
            {{ t.keybindingsChange }}
          </NButton>
          <NButton
            size="tiny"
            quaternary
            :disabled="keybindings.isDefault(def.id)"
            @click="keybindings.resetBinding(def.id)"
          >
            {{ t.keybindingsReset }}
          </NButton>
          <ToggleButton
            :disabled="!keybindings.master"
            :value="keybindings.enabledOf(def.id)"
            @update:value="(value) => keybindings.setEnabled(def.id, value)"
          />
        </div>
      </div>
    </section>

    <section class="group">
      <NText strong>{{ t.keybindingsBuiltinGroup }}</NText>
      <NText depth="3" class="hint">{{ t.keybindingsBuiltinHint }}</NText>
      <div v-for="section in builtinSections" :key="section.group" class="sub-group">
        <NText depth="2" class="sub-title">{{ section.title }}</NText>
        <div class="rows">
          <div v-for="item in section.items" :key="item.labelKey" class="row">
            <span class="label">{{ t[item.labelKey] }}</span>
            <span class="keys plain">{{ item.keys }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.keys-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.switch-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hint {
  font-size: 12px;
}

.divider {
  margin: 0;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.sub-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.sub-title {
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
}

.row + .row {
  border-top: 1px solid var(--border);
}

.row.off .label,
.row.off .keys {
  opacity: 0.5;
}

.label {
  flex: 1;
  min-width: 0;
  color: var(--fg);
}

.keys {
  flex-shrink: 0;
  min-width: 96px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-hover);
  color: var(--fg-strong);
  font-family: var(--mono-font, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 12px;
  text-align: center;
  white-space: nowrap;
}

.keys.plain {
  border-color: transparent;
  background: transparent;
}

.keys.recording {
  border-color: var(--accent);
  color: var(--accent);
}

.keys.conflict {
  border-color: var(--error);
  color: var(--error);
}
</style>
