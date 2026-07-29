import { describe, expect, it } from "vitest";
import {
  commandShouldStartBackground,
  stripBashBackgroundMarker,
} from "../../src/shared/bash-background";

describe("commandShouldStartBackground", () => {
  it("flags common persistent servers", () => {
    expect(commandShouldStartBackground("npm run dev")).toBe(true);
    expect(commandShouldStartBackground("pnpm start")).toBe(true);
    expect(commandShouldStartBackground("npx vite")).toBe(true);
    expect(commandShouldStartBackground("docker compose up")).toBe(true);
    expect(commandShouldStartBackground("python -m http.server 8080")).toBe(true);
  });

  it("does not flag one-shot commands", () => {
    expect(commandShouldStartBackground("npm test")).toBe(false);
    expect(commandShouldStartBackground("npm run build")).toBe(false);
    expect(commandShouldStartBackground("ls -la")).toBe(false);
    expect(commandShouldStartBackground("git status")).toBe(false);
  });

  it("honors explicit marker and strips it", () => {
    const raw = "my-long-server --port 3000 # pi-desktop:background";
    expect(commandShouldStartBackground(raw)).toBe(true);
    expect(stripBashBackgroundMarker(raw)).toEqual({
      command: "my-long-server --port 3000",
      marked: true,
    });
  });

  it("flags shell-level backgrounding / detach", () => {
    expect(commandShouldStartBackground("node server.js &")).toBe(true);
    expect(commandShouldStartBackground("nohup ./serve.sh")).toBe(true);
  });
});
