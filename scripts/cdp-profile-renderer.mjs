/* CDP Profiler for the Pi Desktop renderer main thread. */
import { WebSocket } from "ws";
import http from "node:http";

const DEBUG_PORT = 9223;
const SAMPLE_MS = Number(process.env.CDP_SAMPLE_MS || 9000);

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port: DEBUG_PORT, path },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
  });
}

async function main() {
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await getJson("/json");
      if (
        targets?.some((t) => t.type === "page" && t.url.includes("index.html"))
      )
        break;
    } catch {
      // debugger not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = targets.find(
    (t) => t.type === "page" && t.url.includes("index.html"),
  );
  if (!page)
    throw new Error(
      "page target not found: " +
        JSON.stringify(targets?.map((t) => [t.type, t.url])),
    );
  console.log("attached:", page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl, {
    maxPayload: 512 * 1024 * 1024,
  });
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });

  let seq = 0;
  const pending = new Map();
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: 500 });
  await send("Profiler.start");
  console.log("profiling", SAMPLE_MS, "ms ...");
  await new Promise((r) => setTimeout(r, SAMPLE_MS));
  const stopped = await send("Profiler.stop");
  const profile = stopped.result?.profile;
  if (!profile) throw new Error("no profile");

  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfTime = new Map();
  const interval = 0.5;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const node = nodes.get(id);
    if (!node) continue;
    const name = `${node.callFrame.functionName || "(anon)"} @ ${(node.callFrame.url || "").split("/").pop()}:${node.callFrame.lineNumber}`;
    selfTime.set(name, (selfTime.get(name) || 0) + interval);
  }
  const top = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const totalMs = (profile.samples.length * interval).toFixed(0);
  console.log(`samples=${profile.samples.length} (~${totalMs} ms on-thread)`);
  for (const [name, ms] of top) {
    console.log(`${ms.toFixed(0).padStart(7)} ms  ${name}`);
  }

  const entries = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      res: performance.getEntriesByType("resource").length,
      nav: performance.getEntriesByType("navigation").map(e=>({dcl:Math.round(e.domContentLoadedEventEnd),load:Math.round(e.loadEventEnd)})),
    })`,
    returnByValue: true,
  });
  console.log("page entries:", entries.result?.result?.value);
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
