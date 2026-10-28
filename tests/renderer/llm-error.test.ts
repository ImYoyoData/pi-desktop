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

  it("does not mistake upstream 5xx bodies for an empty model response", () => {
    const cloudflare520 =
      "Open Design: The origin web server sent a response that Cloudflare could not parse. " +
      "This may indicate the origin returned an empty response, malformed HTTP headers, " +
      "or an otherwise invalid response. (520: you can retry your request)";
    expect(formatLlmError(cloudflare520, "zh-CN")).toMatch(/稍后重试/);
  });

  it("maps provider overload separately from worker stuck", () => {
    expect(formatLlmError("upstream provider error from gateway", "zh-CN")).toMatch(/繁忙|上游/);
    expect(formatLlmError("worker unresponsive", "zh-CN")).toMatch(/Worker 无响应/);
  });
});
