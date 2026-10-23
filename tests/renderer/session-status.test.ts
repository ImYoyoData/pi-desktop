import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";
import { useWorkspaceStore } from "../../src/renderer/src/stores/workspace";
import type { AgentEvent, SessionSummary } from "../../src/shared/protocol";

let emit: (event: AgentEvent) => void = () => undefined;

const listMock = vi.fn(async () => [] as SessionSummary[]);
const restartWorkerMock = vi.fn(async () => undefined);

function row(partial: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    cwd: "c:/ws",
    filePath: `c:/ws/.pi/${partial.id}.jsonl`,
    status: "idle",
    modified: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function setupEnv(): void {
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  useWorkspaceStore.setState({ root: "c:/ws" });
  vi.stubGlobal("window", {
    api: {
      sessions: {
        onEvent: (cb: (event: AgentEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
        list: listMock,
        restartWorker: restartWorkerMock,
        command: async () => undefined,
        create: async () => row({ id: "new" }),
        delete: async () => undefined,
      },
    },
  });
}

function statusOf(id: string): string | undefined {
  return useSessionsStore.getState().statusBySession[id];
}

describe("会话状态镜像", () => {
  beforeEach(() => {
    listMock.mockReset().mockResolvedValue([]);
    restartWorkerMock.mockReset().mockResolvedValue(undefined);
    setupEnv();
    useSessionsStore.getState().bindEvents();
  });

  // 回归：自动恢复用 restartWorker(sessionId, null) 重启 worker，
  // 之前会走到 refresh(null) 把整份会话列表清空，listRoot 也被置空——
  // 侧栏的状态同步就此永久失灵，运行完成的会话一直停在「运行中」。
  it("自动恢复重启 worker 后仍保留列表，状态继续跟随事件", async () => {
    useSessionsStore.setState({
      sessions: [row({ id: "s1" })],
      listRoot: "c:/ws",
      activeId: "s1",
    });
    listMock.mockResolvedValue([row({ id: "s1" })]);

    await useSessionsStore.getState().restartWorker("s1", null);

    expect(useSessionsStore.getState().sessions).toHaveLength(1);
    expect(useSessionsStore.getState().listRoot).toBe("c:/ws");
    emit({ type: "session_status", sessionId: "s1", status: "idle" });
    expect(statusOf("s1")).toBe("idle");
  });

  it("其它工作区的会话状态也进镜像", () => {
    emit({ type: "session_status", sessionId: "other", status: "running" });
    expect(statusOf("other")).toBe("running");
  });

  it("列表加载把状态并入镜像", () => {
    useSessionsStore.getState().replaceList("c:/ws", [row({ id: "s1", status: "stuck" })]);
    expect(statusOf("s1")).toBe("stuck");
  });

  it("删除会话时清掉镜像里的状态", async () => {
    useSessionsStore.setState({
      sessions: [row({ id: "s1" })],
      listRoot: "c:/ws",
      activeId: "s1",
    });
    emit({ type: "session_status", sessionId: "s1", status: "running" });
    await useSessionsStore.getState().deleteSession("s1", "c:/ws");
    expect(statusOf("s1")).toBeUndefined();
  });
});
