<script setup lang="ts">
import { ref, watch } from "vue";
import { NButton, NInput, NModal, NRadio, NRadioGroup, NSpace, NText } from "naive-ui";
import { t } from "@renderer/i18n";

const props = defineProps<{
  show: boolean;
  projectRoot: string | null;
}>();

const emit = defineEmits<{
  close: [];
  added: [];
}>();

type Scope = "user" | "project";
type Method = "form" | "json";
type Transport = "command" | "url";

const scope = ref<Scope>("user");
const method = ref<Method>("form");
const transport = ref<Transport>("command");
const name = ref("");
const command = ref("");
const args = ref("");
const url = ref("");
const env = ref("");
const json = ref("");
const error = ref("");
const saving = ref(false);

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    scope.value = "user";
    method.value = "form";
    transport.value = "command";
    name.value = "";
    command.value = "";
    args.value = "";
    url.value = "";
    env.value = "";
    json.value = "";
    error.value = "";
    saving.value = false;
  },
);

function parseEnv(text: string): Record<string, string> | undefined {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      if (index <= 0) throw new Error(t.customizeMcpEnvInvalid);
      return [line.slice(0, index).trim(), line.slice(index + 1)] as const;
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function buildEntry(): Record<string, unknown> {
  if (transport.value === "url") return { url: url.value.trim() };
  const entry: Record<string, unknown> = { command: command.value.trim() };
  const list = args.value.trim() ? args.value.trim().split(/\s+/) : [];
  if (list.length) entry.args = list;
  const envMap = parseEnv(env.value);
  if (envMap) entry.env = envMap;
  return entry;
}

function parseJsonServers(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(t.customizeMcpJsonInvalid);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t.customizeMcpJsonInvalid);
  }
  const record = parsed as Record<string, unknown>;
  const source = record.mcpServers ?? record["mcp-servers"] ?? record;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(t.customizeMcpJsonInvalid);
  }
  const entries = Object.entries(source as Record<string, unknown>);
  if (entries.length === 0) throw new Error(t.customizeMcpJsonInvalid);
  for (const [, value] of entries) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(t.customizeMcpJsonInvalid);
    }
  }
  return source as Record<string, unknown>;
}

function buildServers(): Record<string, unknown> {
  if (method.value === "json") return parseJsonServers(json.value);
  const serverName = name.value.trim();
  if (!serverName) throw new Error(t.customizeMcpNameRequired);
  if (transport.value === "command" && !command.value.trim()) {
    throw new Error(t.customizeMcpTargetRequired);
  }
  if (transport.value === "url" && !url.value.trim()) {
    throw new Error(t.customizeMcpTargetRequired);
  }
  return { [serverName]: buildEntry() };
}

async function submit(): Promise<void> {
  error.value = "";
  let servers: Record<string, unknown>;
  try {
    servers = buildServers();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    return;
  }
  saving.value = true;
  try {
    await window.api.customizations.addMcpServers(
      scope.value,
      servers,
      props.projectRoot ?? undefined,
    );
    emit("added");
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
    class="pi-settings-modal"
    style="width: min(520px, 92vw)"
    :title="t.customizeMcpAddTitle"
    :bordered="false"
    :mask-closable="false"
    @close="emit('close')"
    @update:show="(value: boolean) => !value && emit('close')"
  >
    <div class="mcp-add-form">
      <div class="field">
        <NText strong class="field-label">{{ t.customizeMcpAddScope }}</NText>
        <NRadioGroup v-model:value="scope" name="mcp-add-scope">
          <NSpace :size="16">
            <NRadio value="user">{{ t.customizeGroupUser }}</NRadio>
            <NRadio value="project" :disabled="!projectRoot">
              {{ t.customizeGroupProject }}
            </NRadio>
          </NSpace>
        </NRadioGroup>
      </div>

      <div class="field">
        <NText strong class="field-label">{{ t.customizeMcpAddMethod }}</NText>
        <NRadioGroup v-model:value="method" name="mcp-add-method">
          <NSpace :size="16">
            <NRadio value="form">{{ t.customizeMcpAddForm }}</NRadio>
            <NRadio value="json">{{ t.customizeMcpAddJson }}</NRadio>
          </NSpace>
        </NRadioGroup>
      </div>

      <template v-if="method === 'form'">
        <div class="field">
          <NText strong class="field-label">{{ t.customizeMcpName }}</NText>
          <NInput v-model:value="name" size="small" :placeholder="t.customizeMcpNameExample" />
        </div>

        <div class="field">
          <NText strong class="field-label">{{ t.customizeMcpTransport }}</NText>
          <NRadioGroup v-model:value="transport" name="mcp-add-transport">
            <NSpace :size="16">
              <NRadio value="command">{{ t.customizeMcpTransportCommand }}</NRadio>
              <NRadio value="url">{{ t.customizeMcpTransportUrl }}</NRadio>
            </NSpace>
          </NRadioGroup>
        </div>

        <template v-if="transport === 'command'">
          <div class="field">
            <NText strong class="field-label">{{ t.customizeMcpCommand }}</NText>
            <NInput
              v-model:value="command"
              size="small"
              :placeholder="t.customizeMcpCommandExample"
            />
          </div>
          <div class="field">
            <NText strong class="field-label">{{ t.customizeMcpArgs }}</NText>
            <NInput v-model:value="args" size="small" :placeholder="t.customizeMcpArgsExample" />
          </div>
          <div class="field">
            <NText strong class="field-label">{{ t.customizeMcpEnv }}</NText>
            <NInput
              v-model:value="env"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              :placeholder="t.customizeMcpEnvExample"
            />
          </div>
        </template>

        <div v-else class="field">
          <NText strong class="field-label">{{ t.customizeMcpUrl }}</NText>
          <NInput v-model:value="url" size="small" :placeholder="t.customizeMcpUrlExample" />
        </div>
      </template>

      <div v-else class="field">
        <NText strong class="field-label">{{ t.customizeMcpAddJson }}</NText>
        <NInput
          v-model:value="json"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 10 }"
          placeholder='{"mcpServers": { "name": { "command": "npx", "args": ["-y", "pkg"] } }}'
        />
        <NText depth="3" class="field-hint">{{ t.customizeMcpJsonHint }}</NText>
      </div>

      <NText v-if="error" class="form-error">{{ error }}</NText>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton :disabled="saving" @click="emit('close')">{{ t.cancel }}</NButton>
        <NButton type="primary" :loading="saving" @click="submit">
          {{ t.customizeMcpAddConfirm }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.mcp-add-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
}

.field-hint {
  font-size: 11.5px;
  line-height: 1.45;
}

.form-error {
  color: var(--error);
  font-size: 12px;
}
</style>
