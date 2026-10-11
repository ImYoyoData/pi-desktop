/** 终端程序状态（Program Status Protocol，OSC 7501）：程序上报自己在工作、等用户、完成还是失败。 */

export type ProgramStatusState = "working" | "blocked" | "done" | "error" | "idle";

export type ProgramStatusReport = {
  state: ProgramStatusState;
  app?: string;
  kind?: string;
  message?: string;
};

/** pi 的查询序列；支持的终端回显同样内容。 */
const QUERY = "\x1b]7501;?\x1b\\";
const SEQ_START = "\x1b]7501;";
const BEL = "\x07";
const ST = "\x1b\\";
/** 跨 chunk 未完成序列的保留上限。 */
const MAX_TAIL = 4096;

const STATES = new Set<ProgramStatusState>(["working", "blocked", "done", "error", "idle"]);

function decodeMessage(value: string): string | undefined {
  try {
    const bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes) || undefined;
  } catch {
    return undefined;
  }
}

function parseReport(body: string): ProgramStatusReport | null {
  const report: Partial<ProgramStatusReport> = {};
  for (const pair of body.split(":")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (key === "state" && STATES.has(value as ProgramStatusState)) {
      report.state = value as ProgramStatusState;
    } else if (key === "app" && value) {
      report.app = value;
    } else if (key === "kind" && value) {
      report.kind = value;
    } else if (key === "msg" && value) {
      report.message = decodeMessage(value);
    }
  }
  return report.state ? (report as ProgramStatusReport) : null;
}

export type ProgramStatusScan = {
  /** 收到支持查询时要写回终端的应答。 */
  replies: string[];
  /** 解析到的状态上报。 */
  reports: ProgramStatusReport[];
};

/** 在终端输出流里识别 OSC 7501：应答支持查询、解析状态上报，序列跨 chunk 时保留尾部拼接。 */
export class ProgramStatusScanner {
  private tail = "";

  scan(chunk: string): ProgramStatusScan {
    const text = this.tail + chunk;
    const replies: string[] = [];
    const reports: ProgramStatusReport[] = [];
    let cursor = 0;
    let pendingStart = -1;
    for (;;) {
      const start = text.indexOf(SEQ_START, cursor);
      if (start < 0) break;
      const bodyStart = start + SEQ_START.length;
      let end = -1;
      let endLen = 0;
      const bel = text.indexOf(BEL, bodyStart);
      const st = text.indexOf(ST, bodyStart);
      if (bel >= 0 && (st < 0 || bel < st)) {
        end = bel;
        endLen = BEL.length;
      } else if (st >= 0) {
        end = st;
        endLen = ST.length;
      }
      if (end < 0) {
        pendingStart = start;
        break;
      }
      const body = text.slice(bodyStart, end);
      if (body === "?") {
        replies.push(QUERY);
      } else {
        const report = parseReport(body);
        if (report) reports.push(report);
      }
      cursor = end + endLen;
    }
    if (pendingStart >= 0) {
      this.tail = text.slice(pendingStart, pendingStart + MAX_TAIL);
    } else {
      const esc = text.lastIndexOf("\x1b");
      this.tail = esc >= cursor ? text.slice(esc, esc + MAX_TAIL) : "";
    }
    return { replies, reports };
  }
}
