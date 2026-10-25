import { describe, expect, it } from "vitest";
import {
  buildFinalAnswerIds,
  buildRoundUserByRow,
  buildSettledRowIds,
  buildWorkSectionMembership,
  lastIdPerRound,
} from "../../src/renderer/src/utils/message-rows";
import type { ChatMessage } from "../../src/renderer/src/stores/chat-reducer";

const user = (id: string, text = "hi"): ChatMessage => ({ id, role: "user", text });
const answer = (id: string, text = "done"): ChatMessage => ({ id, role: "assistant", text });
const thinking = (id: string): ChatMessage => ({
  id,
  role: "assistant",
  text: "",
  thinking: "hmm",
});
const tool = (id: string, toolName = "bash"): ChatMessage => ({
  id,
  role: "tool",
  toolCallId: id,
  toolName,
});

describe("buildWorkSectionMembership", () => {
  it("groups consecutive tool rows and marks a single lead", () => {
    const displayed = [user("u1"), tool("t1"), tool("t2"), answer("a1")];
    const map = buildWorkSectionMembership(displayed);
    expect(map.get("t1")?.isLead).toBe(true);
    expect(map.get("t2")?.isLead).toBe(false);
    expect(map.get("t1")?.items.map((m) => m.id)).toEqual(["t1", "t2"]);
    expect(map.get("t1")?.leadId).toBe("t1");
  });

  it("does not wrap a lone tool call", () => {
    const displayed = [user("u1"), tool("t1"), answer("a1")];
    expect(buildWorkSectionMembership(displayed).size).toBe(0);
  });

  it("breaks the streak on interactive tools and answer text", () => {
    const displayed = [
      tool("t1"),
      tool("t2"),
      tool("q1", "ask_user"),
      tool("t3"),
      tool("t4"),
    ];
    const map = buildWorkSectionMembership(displayed);
    expect(map.has("q1")).toBe(false);
    expect(map.get("t1")?.items.map((m) => m.id)).toEqual(["t1", "t2"]);
    expect(map.get("t3")?.items.map((m) => m.id)).toEqual(["t3", "t4"]);
  });
});

describe("buildSettledRowIds", () => {
  it("folds a process group once visible output follows it", () => {
    const displayed = [user("u1"), tool("t1"), tool("t2"), answer("a1")];
    const settled = buildSettledRowIds(displayed, buildWorkSectionMembership(displayed));
    expect([...settled].sort()).toEqual(["t1", "t2"]);
  });

  it("does not fold the trailing group that has no later visible output", () => {
    const displayed = [user("u1"), answer("a1"), user("u2"), tool("t1"), tool("t2")];
    const settled = buildSettledRowIds(displayed, buildWorkSectionMembership(displayed));
    expect(settled.size).toBe(0);
  });

  it("folds process rows in every finished turn, including history", () => {
    const displayed = [
      user("u1"),
      tool("t1"),
      tool("t2"),
      answer("a1"),
      user("u2"),
      tool("t3"),
      answer("a2"),
    ];
    const settled = buildSettledRowIds(displayed, buildWorkSectionMembership(displayed));
    expect([...settled].sort()).toEqual(["t1", "t2", "t3"]);
  });
});

describe("buildFinalAnswerIds", () => {
  it("keeps only the closing assistant text of each round", () => {
    const displayed = [
      user("u1"),
      answer("a1", "first"),
      thinking("h1"),
      answer("a2", "final"),
      user("u2"),
      answer("a3", "only"),
    ];
    expect([...buildFinalAnswerIds(displayed)].sort()).toEqual(["a2", "a3"]);
  });
});

describe("buildRoundUserByRow", () => {
  it("maps non-user rows to the user row of their round", () => {
    const all = [user("u1"), answer("a1"), user("u2"), answer("a2")];
    const map = buildRoundUserByRow(all);
    expect(map.get("a1")?.id).toBe("u1");
    expect(map.get("a2")?.id).toBe("u2");
  });

  it("leaves rows before the first user row unmapped", () => {
    const all = [tool("t0"), user("u1"), answer("a1")];
    expect(buildRoundUserByRow(all).has("t0")).toBe(false);
  });
});

describe("lastIdPerRound", () => {
  it("emits null for rounds without a match", () => {
    const all: ChatMessage[] = [user("u1"), answer("a1"), tool("t1"), user("u2")];
    // 轮以 user 消息分隔：u1 之前、u1~u2 之间、u2 之后共 3 段。
    expect(lastIdPerRound(all, (m) => m.role === "assistant")).toEqual([null, "a1", null]);
  });

  it("keeps the last match inside a round", () => {
    const all: ChatMessage[] = [user("u1"), answer("a1"), answer("a2"), user("u2")];
    expect(lastIdPerRound(all, (m) => m.role === "assistant")).toEqual([null, "a2", null]);
  });
});