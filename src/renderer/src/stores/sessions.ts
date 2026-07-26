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
      case "agent_event": {
        // Only start/end should drive sidebar status — not every stream chunk
        const t = (event.event as { type?: unknown } | undefined)?.type;
        if (t === "agent_start" || t === "turn_start") {
          patchStatus(event.sessionId, "running");
        } else if (t === "agent_end") {
          patchStatus(event.sessionId, "idle");
        }
        break;
      }
      case "prompt_done":
        patchStatus(event.sessionId, "idle");
        break;
      case "prompt_error":
        patchStatus(event.sessionId, "error");
        break;
      case "worker_stuck":
        patchStatus(event.sessionId, "stuck");
        break;
      case "session_status":
        patchStatus(event.sessionId, event.status);
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

  async function deleteSession(sessionId: string, cwd: string): Promise<void> {
    await window.api.sessions.delete(sessionId, cwd);
    if (activeId.value === sessionId) {
      activeId.value = null;
    }
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
  }

  async function renameSession(sessionId: string, cwd: string, name: string): Promise<SessionSummary | null> {
    const updated = await window.api.sessions.rename(sessionId, cwd, name);
    if (updated) upsert(updated);
    return updated;
  }

  let eventsBound = false;
  function bindEvents(): void {
    if (eventsBound) return;
    eventsBound = true;
    const off = window.api.sessions.onEvent((event) => {
      applyEvent(event);
    });
    onScopeDispose(() => {
      eventsBound = false;
      off();
    });
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
    deleteSession,
    renameSession,
    bindEvents,
  };
});
