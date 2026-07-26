<script setup lang="ts">
import { ref, watch } from "vue";
import {
  COMMON_API_KEY_PROVIDERS,
  type CommonApiKeyProvider,
} from "../../../shared/models-settings";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const modelsText = ref("");
const apiKeys = ref<Partial<Record<CommonApiKeyProvider, string>>>({});
const configured = ref<Record<string, boolean>>({});
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const data = await window.api.models.get();
    modelsText.value = data.modelsText;
    configured.value = data.apiKeyConfigured;
    apiKeys.value = {};
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void load();
    }
  },
  { immediate: true },
);

async function save(): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    await window.api.models.set({
      modelsText: modelsText.value,
      apiKeys: { ...apiKeys.value },
    });
    emit("saved");
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

function labelFor(provider: CommonApiKeyProvider): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "google":
      return "Google";
    case "deepseek":
      return "DeepSeek";
    default: {
      const _never: never = provider;
      return _never;
    }
  }
}
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('close')">
    <div class="panel" role="dialog" aria-labelledby="models-settings-title">
      <header class="header">
        <h2 id="models-settings-title">Model settings</h2>
        <button type="button" class="icon-btn" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <p class="hint">Reads and writes <code>~/.pi/agent/models.json</code> and API keys in <code>auth.json</code>.</p>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="loading" class="muted">Loading…</p>

      <section v-else class="section">
        <h3>API keys</h3>
        <div v-for="provider in COMMON_API_KEY_PROVIDERS" :key="provider" class="field">
          <label :for="`key-${provider}`">{{ labelFor(provider) }}</label>
          <input
            :id="`key-${provider}`"
            v-model="apiKeys[provider]"
            type="password"
            autocomplete="off"
            :placeholder="configured[provider] ? 'Leave blank to keep existing key' : 'sk-…'"
          />
        </div>
      </section>

      <section class="section">
        <h3>models.json</h3>
        <textarea v-model="modelsText" class="json" rows="12" spellcheck="false" :disabled="loading" />
      </section>

      <footer class="footer">
        <button type="button" class="btn" :disabled="saving" @click="emit('close')">Cancel</button>
        <button type="button" class="btn primary" :disabled="saving || loading" @click="save">
          {{ saving ? "Saving…" : "Save" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.panel {
  width: min(640px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  padding: 1rem 1.25rem 1.25rem;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.header h2 {
  margin: 0;
  font-size: 1.125rem;
}

.icon-btn {
  border: none;
  background: transparent;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: #6b7280;
}

.hint {
  font-size: 0.8125rem;
  color: #6b7280;
  margin: 0.35rem 0 0.75rem;
}

.section {
  margin-bottom: 1rem;
}

.section h3 {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.field label {
  font-size: 0.8125rem;
  color: #374151;
}

.field input,
.json {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.45rem 0.55rem;
  font: inherit;
}

.json {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.error {
  color: #b91c1c;
  font-size: 0.8125rem;
}

.muted {
  color: #6b7280;
  font-size: 0.8125rem;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.btn {
  font-size: 0.8125rem;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
}

.btn.primary {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
