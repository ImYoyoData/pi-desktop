import { describe, expect, it } from "vitest";
import { formatLlmError } from "../../src/renderer/src/utils/llm-error";

describe("formatLlmError", () => {
  it("maps timeouts to a clear model timeout message", () => {
    expect(formatLlmError("ETIMEDOUT waiting for upstream", "zh-CN")).toMatch(/超时/);
    expect(formatLlmError("Request timed out after 60s", "en")).toMatch(/timed out/i);
  });

  it("maps empty / silent model responses", () => {
    expect(formatLlmError("no response from model", "zh-CN")).toMatch(/未返回/);
  });

  it("maps provider overload separately from worker stuck", () => {
    expect(formatLlmError("upstream provider error from gateway", "zh-CN")).toMatch(/繁忙|上游/);
    expect(formatLlmError("worker unresponsive", "zh-CN")).toMatch(/Worker 无响应/);
  });
});
