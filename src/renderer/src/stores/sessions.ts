import { defineStore } from "pinia";
import { onScopeDispose, ref } from "vue";
import type { AgentCommand, AgentEvent, SessionSummary } from "../../../shared/protocol";

export const useSessionsStore = defineStore("sessions", () => {
  const sessions = ref<SessionSummary[]>([]);
  const activeId = ref<string | null>(null);

  function upsert(summary: SessionSummary): void {
    const idx = sessions.value.findIndex((s) => s.id === summary.id);
    if (idx >= 0) {
      sessions.value[idx] = summary;
    } else {
      sessions.value.push(summary);
    }
  }

  function patchStatus(sessionId: string, status: SessionSummary["status"]): void {
    const row = sessions.value.find((s) => s.id === sessionId);
    if (row) {
      row.status = status;
    }
  }

  function applyEvent(event: AgentEvent): void {
    switch (event.type) {
      case "connected":
        break;
      case "agent_event":
        patchStatus(event.sessionId, "running");
        break;
      case "prompt_done":
        patchStatus(event.sessionId, "idle");
        break;
      case "prompt_error":
        patchStatus(event.sessionId, "error");
        break;
      case "worker_stuck":
        patchStatus(event.sessionId, "stuck");
        break;
      case "worker_exit":
        patchStatus(event.sessionId, "error");
        break;
      default: {
        const _never: never = event;
        void _never;
      }
    }
  }

  async function refresh(cwd: string | null): Promise<void> {
    if (!cwd) {
      sessions.value = [];
      return;
    }
    sessions.value = await window.api.sessions.list(cwd);
  }

  async function createSession(cwd: string): Promise<SessionSummary | null> {
    const created = await window.api.sessions.create(cwd);
    upsert(created);
    activeId.value = created.id;
    return created;
  }

  async function selectSession(sessionId: string, cwd: string): Promise<void> {
    activeId.value = sessionId;
    const opened = await window.api.sessions.open(sessionId, cwd);
    if (opened) {
      upsert(opened);
    }
  }

  async function sendCommand(sessionId: string, command: AgentCommand): Promise<void> {
    if (command.type === "prompt" || command.type === "hang") {
      patchStatus(sessionId, "running");
    }
    await window.api.sessions.command(sessionId, command);
  }

  async function killWorker(sessionId: string, cwd: string | null): Promise<void> {
    await window.api.sessions.killWorker(sessionId);
    await refresh(cwd);
  }

  async function restartWorker(sessionId: string, cwd: string | null): Promise<void> {
    await window.api.sessions.restartWorker(sessionId);
    await refresh(cwd);
  }

  function bindEvents(): void {
    const off = window.api.sessions.onEvent((event) => {
      applyEvent(event);
    });
    onScopeDispose(off);
  }

  return {
    sessions,
    activeId,
    refresh,
    createSession,
    selectSession,
    sendCommand,
    killWorker,
    restartWorker,
    bindEvents,
  };
});
