import { describe, expect, it } from "vitest";
import {
  appendUserMessage,
  createChatState,
  reduceChatEvent,
  withRunClock,
} from "../../src/renderer/src/stores/chat-reducer";
import {
  agentOutputSilenceMs,
  agentWaitPhase,
  agentWaitPhaseId,
  agentWorkerSilenceMs,
  formatElapsedShort,
  syncPhaseClock,
} from "../../src/renderer/src/utils/agent-wait";

describe("agent wait clocks", () => {
  it("stamps turn clocks when a user message starts a run", () => {
    const before = Date.now();
    const state = appendUserMessage(createChatState(), "hello");
    expect(state.running).toBe(true);
    expect(state.turnStartedAt).toBeGreaterThanOrEqual(before);
    expect(state.phaseStartedAt).toBeGreaterThanOrEqual(before);
    expect(state.lastActivityAt).toBeGreaterThanOrEqual(before);
  });

  it("clears clocks when the turn ends", () => {
    let state = appendUserMessage(createChatState(), "hello");
    state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
    expect(state.running).toBe(false);
    expect(state.turnStartedAt).toBeNull();
    expect(state.phaseStartedAt).toBeNull();
    expect(state.lastActivityAt).toBeNull();
    expect(state.lastWorkerAliveAt).toBeNull();
  });

  it("updates worker alive without treating it as output activity", () => {
    let state = withRunClock(
      { ...createChatState(), running: true, turnStartedAt: 1000, lastActivityAt: 1000 },
      { activity: false, now: 1000 },
    );
    state = reduceChatEvent(state, { type: "worker_alive", sessionId: "s" });
    expect(state.lastActivityAt).toBe(1000);
    expect(state.lastWorkerAliveAt).toBeGreaterThanOrEqual(1000);
  });
});

describe("agentWaitPhase", () => {
  it("reports waiting_model when running with no stream", () => {
    const state = withRunClock(
      { ...createChatState(), running: true },
      { activity: true, now: 1 },
    );
    expect(agentWaitPhase(state)).toBe("waiting_model");
  });

  it("reports tool when streaming a tool call", () => {
    const state = {
      ...createChatState(),
      running: true,
      turnStartedAt: 1,
      lastActivityAt: 1,
      streamingMessage: {
        id: "t1",
        role: "tool" as const,
        toolCallId: "tc",
        toolName: "bash",
        streaming: true,
      },
    };
    expect(agentWaitPhase(state)).toBe("tool");
  });
});

describe("syncPhaseClock", () => {
  it("resets phaseStartedAt when wait phase changes, keeps turnStartedAt", () => {
    const waiting = syncPhaseClock(
      createChatState(),
      {
        ...createChatState(),
        running: true,
        turnStartedAt: 1_000,
        phaseStartedAt: 1_000,
        lastActivityAt: 1_000,
      },
      1_000,
    );
    expect(agentWaitPhaseId(waiting)).toBe("waiting_model");
    expect(waiting.phaseStartedAt).toBe(1_000);

    const thinking = syncPhaseClock(
      waiting,
      {
        ...waiting,
        streamingMessage: {
          id: "a1",
          role: "assistant",
          text: "",
          thinking: "plan",
          streaming: true,
        },
        lastActivityAt: 5_000,
      },
      5_000,
    );
    expect(agentWaitPhaseId(thinking)).toBe("thinking");
    expect(thinking.turnStartedAt).toBe(1_000);
    expect(thinking.phaseStartedAt).toBe(5_000);

    const writing = syncPhaseClock(
      thinking,
      {
        ...thinking,
        streamingMessage: {
          id: "a1",
          role: "assistant",
          text: "hello",
          thinking: "plan",
          streaming: true,
        },
        lastActivityAt: 8_000,
      },
      8_000,
    );
    expect(agentWaitPhaseId(writing)).toBe("writing");
    expect(writing.turnStartedAt).toBe(1_000);
    expect(writing.phaseStartedAt).toBe(8_000);
  });

  it("resets when switching between tools", () => {
    const bash = {
      ...createChatState(),
      running: true,
      turnStartedAt: 1,
      phaseStartedAt: 10,
      lastActivityAt: 10,
      streamingMessage: {
        id: "t1",
        role: "tool" as const,
        toolCallId: "1",
        toolName: "bash",
        streaming: true,
      },
    };
    const edit = syncPhaseClock(
      bash,
      {
        ...bash,
        phaseStartedAt: 10,
        streamingMessage: {
          id: "t2",
          role: "tool" as const,
          toolCallId: "2",
          toolName: "edit",
          streaming: true,
        },
      },
      50,
    );
    expect(edit.phaseStartedAt).toBe(50);
  });
});

describe("agent wait silence helpers", () => {
  it("formats elapsed time", () => {
    expect(formatElapsedShort(5_000)).toBe("5s");
    expect(formatElapsedShort(65_000)).toBe("1m 5s");
  });

  it("measures output vs worker silence", () => {
    const state = {
      ...createChatState(),
      running: true,
      turnStartedAt: 0,
      lastActivityAt: 10_000,
      lastWorkerAliveAt: 40_000,
    };
    expect(agentOutputSilenceMs(state, 50_000)).toBe(40_000);
    expect(agentWorkerSilenceMs(state, 50_000)).toBe(10_000);
  });
});

describe("stampThinkingClock", () => {
  it("starts a clock when thinking begins and freezes on finalize", async () => {
    const { stampThinkingClock } = await import("../../src/renderer/src/stores/chat-reducer");
    const started = stampThinkingClock(
      {
        id: "a1",
        role: "assistant",
        text: "",
        thinking: "hmm",
        streaming: true,
      },
      { now: 1_000 },
    );
    expect(started.thinkingStartedAt).toBe(1_000);
    expect(started.thinkingDurationMs).toBeUndefined();

    const done = stampThinkingClock(started, { now: 4_500, finalize: true });
    expect(done.thinkingStartedAt).toBeUndefined();
    expect(done.thinkingDurationMs).toBe(3_500);
  });

  it("finalizes when answer text arrives", async () => {
    const { stampThinkingClock } = await import("../../src/renderer/src/stores/chat-reducer");
    const mid = stampThinkingClock(
      {
        id: "a1",
        role: "assistant",
        text: "hello",
        thinking: "plan",
        thinkingStartedAt: 1_000,
        streaming: true,
      },
      { now: 2_200 },
    );
    expect(mid.thinkingDurationMs).toBe(1_200);
    expect(mid.thinkingStartedAt).toBeUndefined();
  });
});
