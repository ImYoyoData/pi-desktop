import { describe, expect, it } from "vitest";
import {
  commandShouldStartBackground,
  stripBashBackgroundMarker,
} from "../../src/shared/bash-background";

describe("bash-background", () => {
  it("strips the explicit marker and reports it", () => {
    const result = stripBashBackgroundMarker("npm run dev # pi-desktop:background");
    expect(result).toEqual({ command: "npm run dev", marked: true });
  });

  it("does not treat the marker string inside the command body as opt-in", () => {
    const command = 'grep -rn "pi-desktop:background" src | head -20';
    expect(stripBashBackgroundMarker(command)).toEqual({ command, marked: false });
    expect(commandShouldStartBackground(command)).toBe(false);
  });

  it("does not strip a marker-shaped comment that is not at the end", () => {
    const command = 'grep -rn " # pi-desktop:background" src';
    expect(stripBashBackgroundMarker(command)).toEqual({ command, marked: false });
  });

  it("detects persistent launchers", () => {
    expect(commandShouldStartBackground("npm run dev")).toBe(true);
    expect(commandShouldStartBackground("pnpm dev")).toBe(true);
    expect(commandShouldStartBackground("yarn start")).toBe(true);
    expect(commandShouldStartBackground("cd web && npm run dev")).toBe(true);
    expect(commandShouldStartBackground("vite --port 3000")).toBe(true);
    expect(commandShouldStartBackground("npx vite")).toBe(true);
    expect(commandShouldStartBackground("pnpm exec vite")).toBe(true);
    expect(commandShouldStartBackground("next dev")).toBe(true);
    expect(commandShouldStartBackground("tail -f app.log")).toBe(true);
    expect(commandShouldStartBackground("tail -n 100 -f app.log")).toBe(true);
  });

  it("looks inside a shell -c wrapper", () => {
    expect(commandShouldStartBackground('sh -c "npm run dev"')).toBe(true);
    expect(commandShouldStartBackground('bash -lc "npm run dev"')).toBe(true);
    expect(commandShouldStartBackground('cd web && sh -c "npm run dev"')).toBe(true);
    expect(commandShouldStartBackground('sh -c "npm run build"')).toBe(false);
  });

  it("does not split on separators inside quotes", () => {
    expect(
      commandShouldStartBackground('git commit -m "fix; npm run dev"'),
    ).toBe(false);
    expect(
      commandShouldStartBackground(`node -e "console.log('a|b'); require('./s')"`),
    ).toBe(false);
  });

  it("detects launchers behind environment assignments", () => {
    expect(commandShouldStartBackground("PORT=3000 npm run dev")).toBe(true);
    expect(commandShouldStartBackground("NODE_ENV=production npm start")).toBe(true);
    expect(commandShouldStartBackground('NODE_ENV="production mode" next dev')).toBe(true);
    expect(commandShouldStartBackground("A=1 B=2 pnpm dev")).toBe(true);
    expect(commandShouldStartBackground("env PORT=3000 vite")).toBe(true);
    expect(commandShouldStartBackground("cd web && PORT=3000 npm run dev")).toBe(true);
  });

  it("ignores commands that merely mention a server name", () => {
    expect(commandShouldStartBackground("grep -rn next src")).toBe(false);
    expect(commandShouldStartBackground("cat vite.config.ts")).toBe(false);
    expect(commandShouldStartBackground("git log --grep serve")).toBe(false);
    expect(commandShouldStartBackground("npm install next")).toBe(false);
  });

  it("does not detach one-shot builds", () => {
    expect(commandShouldStartBackground("next build")).toBe(false);
    expect(commandShouldStartBackground("vite build")).toBe(false);
  });

  it("still honors shell backgrounding", () => {
    expect(commandShouldStartBackground("sleep 30 &")).toBe(true);
    expect(commandShouldStartBackground("nohup ./server.sh")).toBe(true);
  });
});
