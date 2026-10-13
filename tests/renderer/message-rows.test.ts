import { describe, expect, it } from "vitest";
import {
  buildFinalAnswerIds,
  buildRoundUserByRow,
  buildSettledRowIds,
  buildWorkSectionMembership,
  displayMessageRows,
  lastIdPerRound,
  latestTurnStartIndex,
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

describe("latestTurnStartIndex", () => {
  it("returns the last user row index", () => {
    expect(latestTurnStartIndex([user("u1"), tool("t1"), user("u2")])).toBe(2);
  });

  it("returns -1 when there is no user row", () => {
    expect(latestTurnStartIndex([tool("t1"), answer("a1")])).toBe(-1);
  });
});

describe("displayMessageRows", () => {
  it("drops tool and thinking-only rows from finished turns", () => {
    const all = [user("u1"), tool("t1"), thinking("h1"), answer("a1"), user("u2")];
    const out = displayMessageRows(all, latestTurnStartIndex(all));
    expect(out.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("keeps process rows of the latest turn", () => {
    const all = [user("u1"), answer("a1"), user("u2"), tool("t2")];
    const out = displayMessageRows(all, latestTurnStartIndex(all));
    expect(out.map((m) => m.id)).toEqual(["u1", "a1", "u2", "t2"]);
  });

  it("keeps interactive ask_user rows visible in history", () => {
    const all = [user("u1"), tool("t1", "ask_user"), user("u2")];
    const out = displayMessageRows(all, latestTurnStartIndex(all));
    expect(out.map((m) => m.id)).toEqual(["u1", "t1", "u2"]);
  });

  it("treats every row as the latest turn when there is no user row", () => {
    const all = [tool("t1"), thinking("h1"), answer("a1")];
    const out = displayMessageRows(all, latestTurnStartIndex(all));
    expect(out.map((m) => m.id)).toEqual(["t1", "h1", "a1"]);
  });
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

  it("does not fold process rows before the latest turn start", () => {
    // displayMessageRows 已经裁掉历史过程行，这里保证剩余集合里不会误折叠 user 行。
    const displayed = [user("u1"), answer("a1")];
    expect(buildSettledRowIds(displayed, buildWorkSectionMembership(displayed)).size).toBe(0);
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