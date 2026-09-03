/* CDP Network + script timing capture for Pi Desktop renderer startup. */
import { WebSocket } from "ws";
import http from "node:http";

const DEBUG_PORT = 9223;
const CAPTURE_MS = Number(process.env.CDP_CAPTURE_MS || 12000);

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
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = targets.find(
    (t) => t.type === "page" && t.url.includes("index.html"),
  );
  if (!page) throw new Error("page target not found");

  const ws = new WebSocket(page.webSocketDebuggerUrl, {
    maxPayload: 512 * 1024 * 1024,
  });
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });

  let seq = 0;
  const pending = new Map();
  const requests = new Map();
  const finished = [];
  const scripts = [];
  const t0 = Date.now();

  let firstTs = 0;

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
      return;
    }
    if (msg.method === "Network.requestWillBeSent") {
      requests.set(msg.params.requestId, {
        url: msg.params.request.url,
        start: msg.params.timestamp,
        type: msg.params.type,
      });
      if (!firstTs) firstTs = msg.params.timestamp;
    } else if (msg.method === "Network.loadingFinished") {
      const r = requests.get(msg.params.requestId);
      if (r) {
        finished.push({
          url: r.url,
          dur: (msg.params.timestamp - r.start) * 1000,
          size: msg.params.encodedDataLength,
          start: (r.start - firstTs) * 1000,
        });
      }
    } else if (msg.method === "Debugger.scriptParsed") {
      const p = msg.params;
      if (p.url && p.url.includes("assets")) {
        scripts.push({
          url: p.url.split("/").pop(),
          len: p.length ?? -1,
          at: Date.now() - t0,
        });
      }
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Network.enable");
  await send("Debugger.enable");
  console.log("capturing", CAPTURE_MS, "ms ...");
  await new Promise((r) => setTimeout(r, CAPTURE_MS));

  const rows = finished
    .map((f) => ({
      name: f.url.split("/").pop(),
      start: Math.round(f.start),
      dur: Math.round(f.dur),
      kb: Math.round(f.size / 1024),
    }))
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 30);
  console.log("--- slowest fetches (start ms since attach, dur ms, KB) ---");
  for (const r of rows)
    console.log(
      `  start=${String(r.start).padStart(6)} dur=${String(r.dur).padStart(6)} ${String(r.kb).padStart(6)}KB  ${r.name}`,
    );

  const late = scripts.sort((a, b) => a.at - b.at);
  console.log("--- scripts parsed (ms since attach) ---");
  for (const s of late.slice(0, 40))
    console.log(
      `  at=${String(s.at).padStart(6)}  ${String(Math.round(s.len / 1024)).padStart(6)}KB  ${s.url}`,
    );
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
