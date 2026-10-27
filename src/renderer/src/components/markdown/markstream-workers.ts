import { setKaTeXWorker, setMermaidWorker } from "markstream-react";

let installed = false;

/**
 * 公式与图表解析放 worker，主线程只做布局。
 *
 * 用 inline worker（blob URL）：生产窗口是 file://，直接 new Worker(file://…)
 * 会被跨源策略拦掉；inline 版本不依赖脚本地址。构造失败就不注入，渲染退回主线程。
 */
export function installMarkstreamWorkers(): void {
  if (installed) return;
  installed = true;
  void (async () => {
    try {
      const [{ default: KatexWorker }, { default: MermaidWorker }] = await Promise.all([
        import("markstream-react/workers/katexRenderer.worker?worker&inline"),
        import("markstream-react/workers/mermaidParser.worker?worker&inline"),
      ]);
      setKaTeXWorker(new KatexWorker());
      setMermaidWorker(new MermaidWorker());
    } catch {
      // 主线程解析
    }
  })();
}
