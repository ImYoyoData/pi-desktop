import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROXY_SETTINGS,
  isProxyActive,
  normalizeProxyUrl,
  PROXY_ENV_KEYS,
  proxyEnvFromPacResult,
  proxyEnvFromUrl,
} from "../../src/shared/proxy";

describe("normalizeProxyUrl", () => {
  it("accepts full http/https/socks5 URLs", () => {
    expect(normalizeProxyUrl("http://127.0.0.1:7890")).toBe(
      "http://127.0.0.1:7890",
    );
    expect(normalizeProxyUrl("https://proxy.example.com:8443")).toBe(
      "https://proxy.example.com:8443",
    );
    expect(normalizeProxyUrl("socks5://127.0.0.1:1080")).toBe(
      "socks5://127.0.0.1:1080",
    );
  });

  it("adds http:// when the scheme is missing", () => {
    expect(normalizeProxyUrl("127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
    expect(normalizeProxyUrl("proxy.local:3128")).toBe(
      "http://proxy.local:3128",
    );
  });

  it("strips credentials, path and trailing slash", () => {
    expect(normalizeProxyUrl("http://user:pass@127.0.0.1:7890/")).toBe(
      "http://127.0.0.1:7890",
    );
    expect(normalizeProxyUrl("http://127.0.0.1:7890/some/path?q=1#f")).toBe(
      "http://127.0.0.1:7890",
    );
  });

  it("rejects empty input and unsupported protocols", () => {
    expect(normalizeProxyUrl("")).toBeNull();
    expect(normalizeProxyUrl("   ")).toBeNull();
    expect(normalizeProxyUrl("ftp://127.0.0.1:21")).toBeNull();
    expect(normalizeProxyUrl("not a url ::")).toBeNull();
    expect(normalizeProxyUrl("http://")).toBeNull();
  });
});

describe("proxyEnvFromUrl", () => {
  it("produces upper- and lowercase env vars", () => {
    const env = proxyEnvFromUrl("http://127.0.0.1:7890");
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.ALL_PROXY).toBe("http://127.0.0.1:7890");
    expect(env.http_proxy).toBe("http://127.0.0.1:7890");
    expect(env.https_proxy).toBe("http://127.0.0.1:7890");
    expect(env.all_proxy).toBe("http://127.0.0.1:7890");
  });

  it("returns an empty object for invalid URLs", () => {
    expect(proxyEnvFromUrl("not a url")).toEqual({});
  });

  it("PROXY_ENV_KEYS covers every key proxyEnvFromUrl sets (plus NO_PROXY)", () => {
    for (const key of Object.keys(proxyEnvFromUrl("http://127.0.0.1:7890"))) {
      expect(PROXY_ENV_KEYS).toContain(key);
    }
    expect(PROXY_ENV_KEYS).toContain("NO_PROXY");
    expect(PROXY_ENV_KEYS).toContain("no_proxy");
  });
});

describe("proxyEnvFromPacResult", () => {
  it("maps PROXY entries to http:// env vars", () => {
    const env = proxyEnvFromPacResult("PROXY 192.168.1.10:8080; DIRECT");
    expect(env.HTTP_PROXY).toBe("http://192.168.1.10:8080");
  });

  it("maps SOCKS5 entries to socks5:// env vars", () => {
    const env = proxyEnvFromPacResult("SOCKS5 127.0.0.1:1080");
    expect(env.ALL_PROXY).toBe("socks5://127.0.0.1:1080");
  });

  it("returns {} for DIRECT and garbage", () => {
    expect(proxyEnvFromPacResult("DIRECT")).toEqual({});
    expect(proxyEnvFromPacResult("")).toEqual({});
    expect(proxyEnvFromPacResult("???")).toEqual({});
  });
});

describe("isProxyActive", () => {
  it("reflects mode and URL validity", () => {
    expect(isProxyActive(DEFAULT_PROXY_SETTINGS)).toBe(false);
    expect(isProxyActive({ mode: "system", url: "" })).toBe(true);
    expect(
      isProxyActive({ mode: "custom", url: "http://127.0.0.1:7890" }),
    ).toBe(true);
    expect(isProxyActive({ mode: "custom", url: "garbage :: :" })).toBe(false);
  });
});
