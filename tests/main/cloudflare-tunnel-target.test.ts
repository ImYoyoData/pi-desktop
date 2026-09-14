import { describe, expect, it } from "vitest";
import { tunnelTargetOf } from "../../src/main/cloudflare-tunnel";
import { namedTunnelArgs, quickTunnelFlags } from "../../src/shared/cloudflare-tunnel";

/**
 * Guards for the tunnel target/flags contract.
 *
 * Two things here were learned the hard way and must not regress:
 * - `--no-autoupdate` is a `tunnel`-command flag and MUST precede the `run`
 *   subcommand, or cloudflared exits with
 *   "flag provided but not defined: -no-autoupdate".
 * - the transport protocol is deliberately NOT forced: `--protocol http2` was
 *   measured to make quick tunnels unreachable here (15 probes / 60s) while the
 *   default `auto` worked in seconds.
 */
describe("tunnelTargetOf", () => {
  it("runs the accountless quick tunnel when no token is configured", () => {
    expect(tunnelTargetOf({ originPort: 18700 })).toEqual({
      kind: "quick",
      targetUrl: "http://127.0.0.1:18700",
    });
  });

  it("switches to the named tunnel once a token exists (stable hostname)", () => {
    expect(
      tunnelTargetOf({ tunnelToken: "tok-123", publicUrl: "https://pi.example.com", originPort: 18700 }),
    ).toEqual({ kind: "named", token: "tok-123", publicUrl: "https://pi.example.com" });
  });

  it("ignores a whitespace-only token", () => {
    expect(tunnelTargetOf({ tunnelToken: "   ", originPort: 18700 }).kind).toBe("quick");
  });

  it("keeps a named tunnel even when the user typed no public hostname", () => {
    // The tunnel still runs; the panel just cannot advertise a URL until set.
    expect(tunnelTargetOf({ tunnelToken: "tok", publicUrl: "", originPort: 18700 })).toEqual({
      kind: "named",
      token: "tok",
      publicUrl: "",
    });
  });
});

describe("tunnel flags", () => {
  it("disables autoupdate and leaves the transport protocol at auto", () => {
    expect(quickTunnelFlags()).toEqual({ "--no-autoupdate": true });
    expect(quickTunnelFlags()).not.toHaveProperty("--protocol");
  });

  it("puts the flags BEFORE the run subcommand for named tunnels", () => {
    const args = namedTunnelArgs("tok-abc");
    expect(args).toEqual(["tunnel", "--no-autoupdate", "run", "--token", "tok-abc"]);
    const runIndex = args.indexOf("run");
    expect(args.indexOf("--no-autoupdate")).toBeLessThan(runIndex);
    expect(args.indexOf("--token")).toBeGreaterThan(runIndex);
    expect(args).not.toContain("--protocol");
  });
});
