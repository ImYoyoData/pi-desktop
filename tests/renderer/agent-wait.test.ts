import { describe, expect, it } from "vitest";
import {
  appendUserMessage,
  createChatState,
  reduceChatEvent,
  withRunClock,
} from "../../src/renderer/src/stores/chat-reducer";
import {
  agentOutputSilenceMs,
  agentWaitNetwork,
  agentWaitPhase,
  agentWaitPhaseId,
  agentWaitRound,
  agentWorkerSilenceMs,
  clipRequestError,
  formatElapsedShort,
  formatTokenCount,
  httpStatusKind,
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

describe("agentWaitNetwork", () => {
  function runningState() {
    return appendUserMessage(createChatState(), "hello");
  }

  it("reports the request stage from llm_progress events", () => {
    let state = runningState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: { type: "llm_progress", stage: "sent", host: "api.test", at: 1_000 },
    });
    expect(agentWaitNetwork(state, 4_000)).toEqual({
      stage: "sent",
      host: "api.test",
      elapsedMs: 3_000,
    });

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "llm_progress",
        stage: "response",
        host: "api.test",
        status: 200,
        at: 2_000,
      },
    });
    expect(agentWaitNetwork(state, 5_000)).toEqual({
      stage: "response",
      host: "api.test",
      status: 200,
      elapsedMs: 3_000,
    });
  });

  it("reports the failure reason as one clipped line", () => {
    let state = runningState();
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "llm_progress",
        stage: "failed",
        host: "api.test",
        at: 1_000,
        error: `connect\n  refused\n${"x".repeat(200)}`,
      },
    });
    const network = agentWaitNetwork(state, 2_000);
    expect(network?.stage).toBe("failed");
    expect(network?.error?.startsWith("connect refused xx")).toBe(true);
    expect(network?.error?.includes("\n")).toBe(false);
    expect(network?.error?.length).toBeLessThanOrEqual(120);
  });

  it("clips a long error string to a single line", () => {
    expect(clipRequestError("a\n  b")).toBe("a b");
    expect(clipRequestError("x".repeat(300)).length).toBe(120);
  });

  it("keeps the silence clock untouched and clears on turn end", () => {
    let state = runningState();
    const activityBefore = state.lastActivityAt;
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: { type: "llm_progress", stage: "sent", host: "api.test", at: 1_000 },
    });
    expect(state.lastActivityAt).toBe(activityBefore);
    expect(state.llmProgress?.host).toBe("api.test");

    state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
    expect(state.llmProgress).toBeNull();
    expect(agentWaitNetwork(state, 9_000)).toBeNull();
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

  it("leaves an already-finished message without a duration instead of 0ms", async () => {
    const { stampThinkingClock } = await import("../../src/renderer/src/stores/chat-reducer");
    const done = stampThinkingClock(
      {
        id: "a1",
        role: "assistant",
        text: "answer",
        thinking: "thought",
        streaming: false,
      },
      { now: 5_000, finalize: true },
    );
    expect(done.thinkingStartedAt).toBeUndefined();
    expect(done.thinkingDurationMs).toBeUndefined();
  });
});

describe("httpStatusKind", () => {
  it("classifies status codes the UI distinguishes", () => {
    expect(httpStatusKind(200)).toBe("ok");
    expect(httpStatusKind(429)).toBe("limited");
    expect(httpStatusKind(503)).toBe("server");
    expect(httpStatusKind(401)).toBe("rejected");
    expect(httpStatusKind(undefined)).toBeNull();
  });
});

describe("agentWaitRound", () => {
  it("reports the round and tool count only while running", () => {
    const base = appendUserMessage(createChatState(), "hi");
    expect(agentWaitRound(base)).toBeNull();
    expect(agentWaitRound({ ...base, llmRound: 3, nextToolOrder: 3 })).toEqual({
      round: 3,
      tools: 2,
    });
    expect(agentWaitRound({ ...base, running: false, llmRound: 3 })).toBeNull();
  });
});

describe("formatTokenCount", () => {
  it("shortens token counts", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(12_300)).toBe("12.3k");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });
});

describe("compaction state", () => {
  it("tracks compaction_start/end and exposes the compacting phase", () => {
    let state = appendUserMessage(createChatState(), "hi");
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "compaction_start",
        reason: "overflow",
        tokens: 123_000,
        contextWindow: 146_000,
      },
    });
    expect(state.compaction).toMatchObject({
      reason: "overflow",
      tokens: 123_000,
      contextWindow: 146_000,
    });
    expect(agentWaitPhase(state)).toBe("compacting");

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: { type: "compaction_end", reason: "overflow", summary: "sum" },
    });
    expect(state.compaction).toBeNull();
  });

  it("records duration and summary cost on the card, and reports cancellation", () => {
    let state = appendUserMessage(createChatState(), "hi");
    state = {
      ...state,
      compaction: { reason: "threshold", startedAt: Date.now() - 5_000, enterRunning: true },
    };
    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: {
        type: "compaction_end",
        reason: "threshold",
        summary: "sum",
        tokensBefore: 120_000,
        summaryTokens: 1_800,
      },
    });
    const card = state.messages.at(-1);
    expect(card).toMatchObject({
      role: "summary",
      kind: "compaction",
      tokensBefore: 120_000,
      summaryTokens: 1_800,
    });
    expect(card?.role === "summary" ? card.durationMs : 0).toBeGreaterThanOrEqual(4_000);
    // 回合内的自动压缩：结束后回合继续跑。
    expect(state.running).toBe(true);

    const cancelled = reduceChatEvent(
      {
        ...appendUserMessage(createChatState(), "hi"),
        compaction: { reason: "manual", startedAt: Date.now(), enterRunning: false },
      },
      {
        type: "agent_event",
        sessionId: "s",
        event: { type: "compaction_end", reason: "manual", aborted: true },
      },
    );
    expect(cancelled.compaction).toBeNull();
    expect(cancelled.messages.at(-1)).toMatchObject({ role: "error", variant: "cancelled" });
  });

  it("restores the turn state after a manual compaction", () => {
    let state = reduceChatEvent(
      { ...createChatState(), running: false },
      {
        type: "agent_event",
        sessionId: "s",
        event: { type: "compaction_start", reason: "manual" },
      },
    );
    expect(state.running).toBe(true);
    expect(state.compaction?.enterRunning).toBe(false);

    state = reduceChatEvent(state, {
      type: "agent_event",
      sessionId: "s",
      event: { type: "compaction_end", reason: "manual", summary: "sum" },
    });
    // /compact 没有回合收尾事件，不能把界面留在「运行中」。
    expect(state.running).toBe(false);
    expect(state.turnStartedAt).toBeNull();
  });

  it("counts rounds from turn_start and clears on turn end", () => {
    let state = appendUserMessage(createChatState(), "hi");
    const round = (event: Record<string, unknown>) =>
      reduceChatEvent(state, { type: "agent_event", sessionId: "s", event });
    state = round({ type: "agent_start" });
    expect(state.llmRound).toBe(0);
    state = round({ type: "turn_start" });
    expect(state.llmRound).toBe(1);
    state = round({ type: "turn_start" });
    expect(state.llmRound).toBe(2);

    state = reduceChatEvent(state, { type: "prompt_done", sessionId: "s" });
    expect(state.llmRound).toBe(0);
    expect(state.compaction).toBeNull();
  });
});
