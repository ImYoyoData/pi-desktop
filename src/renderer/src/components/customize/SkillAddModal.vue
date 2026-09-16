<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NInput, NModal, NSelect, NSpace, NText } from "naive-ui";
import { t } from "@renderer/i18n";

const props = defineProps<{
  show: boolean;
  workspaces: string[];
}>();

const emit = defineEmits<{
  close: [];
  added: [payload: { filePath: string; name: string }];
}>();

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const scope = ref<string>("user");
const name = ref("");
const description = ref("");
const error = ref("");
const saving = ref(false);

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    scope.value = "user";
    name.value = "";
    description.value = "";
    error.value = "";
    saving.value = false;
  },
);

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

/** 工作区重名时显示完整路径以便区分。 */
function workspaceLabel(target: string): string {
  const base = baseName(target);
  const duplicated = props.workspaces.filter((p) => baseName(p) === base).length > 1;
  return duplicated ? target : base;
}

const scopeOptions = computed(() => [
  { label: t.customizeGroupUser, value: "user" },
  ...props.workspaces.map((target) => ({ label: workspaceLabel(target), value: target })),
]);

function validate(skillName: string): string | null {
  if (!skillName) return t.customizeSkillNameRequired;
  if (skillName.length > 64 || !SKILL_NAME_PATTERN.test(skillName)) {
    return t.customizeSkillNameInvalid;
  }
  return null;
}

async function submit(): Promise<void> {
  const skillName = name.value.trim();
  error.value = validate(skillName) ?? "";
  if (error.value) return;
  const userScope = scope.value === "user";
  saving.value = true;
  try {
    const { filePath } = await window.api.customizations.create("skills", {
      name: skillName,
      description: description.value.trim() || undefined,
      scope: userScope ? "user" : "project",
      workspace: userScope ? undefined : scope.value,
    });
    emit("added", { filePath, name: skillName });
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="pi-settings-modal skill-add-modal"
    style="width: min(560px, 92vw)"
    :bordered="false"
    :mask-closable="false"
    @close="emit('close')"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <template #header>
      <div class="modal-title-block">
        <div class="modal-title">{{ t.customizeSkillAddTitle }}</div>
        <div class="modal-subtitle">{{ t.customizeSkillAddSubtitle }}</div>
      </div>
    </template>

    <div class="section skill-form-card">
      <div class="field-row">
        <div class="field name-field">
          <span class="field-label">{{ t.customizeSkillName }}</span>
          <NInput
            v-model:value="name"
            size="small"
            :placeholder="t.customizeSkillNameExample"
            @keyup.enter="submit"
          />
          <NText depth="3" class="field-hint">{{ t.customizeSkillNameHint }}</NText>
        </div>
        <div class="scope-field">
          <span class="field-label">{{ t.customizeSkillScope }}</span>
          <NSelect v-model:value="scope" size="small" class="scope-select" :options="scopeOptions" />
        </div>
      </div>

      <div class="field">
        <span class="field-label">{{ t.customizeSkillDescription }}</span>
        <NInput
          v-model:value="description"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          :placeholder="t.customizeSkillDescriptionExample"
        />
      </div>
    </div>

    <NText v-if="error" class="form-error">{{ error }}</NText>

    <template #footer>
      <NSpace justify="end">
        <NButton type="primary" :loading="saving" @click="submit">
          {{ t.customizeSkillSave }}
        </NButton>
        <NButton :disabled="saving" @click="emit('close')">{{ t.cancel }}</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.skill-add-modal :deep(.n-card-header) {
  align-items: flex-start;
}

.modal-title-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.modal-title {
  font-size: 15px;
  font-weight: 650;
  color: var(--fg-strong);
}

.modal-subtitle {
  font-size: 12px;
  color: var(--fg-muted);
}

.skill-form-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.name-field {
  flex: 0 1 280px;
  min-width: 0;
}

.scope-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.scope-select {
  width: 150px;
}

.field-label {
  font-size: 12px;
  color: var(--fg-muted);
}

.field-hint {
  font-size: 11.5px;
  line-height: 1.45;
}

.form-error {
  color: var(--error);
  font-size: 12px;
  margin-top: 10px;
}
</style>
