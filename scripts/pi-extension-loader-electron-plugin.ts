import type { Plugin } from "vite";

/**
 * Pi 扩展加载器按运行时选择模块解析方式：Bun/SEA/内置 Node 走 virtualModules
 * （产物内已打包的 Pi/typebox），普通 Node 走 getAliases() 别名。
 *
 * Electron 主进程把加载器打成 CJS，getAliases() 的 import.meta.resolve 退化为
 * require.resolve，而 Pi 各包是 ESM-only（exports 只有 import 条件），解析必然
 * 抛 ERR_PACKAGE_PATH_NOT_EXPORTED，扩展加载全部失败 —— 表现就是插件工具在
 * Agent 会话和设置-工具页同时消失。
 *
 * 把兜底分支的 { alias: getAliases() } 换成 virtualModules，让扩展改用产物内
 * 已打包的模块，与 Bun 单文件模式一致。
 */
export function piExtensionLoaderElectronPlugin(): Plugin {
  const propertyReplacement =
    "{ virtualModules: await getVirtualModules(), tryNative: false }";

  const rewrite = (code: string): string | null => {
    if (!code.includes("alias: getAliases()")) return null;
    if (!code.includes("getVirtualModules")) return null;
    const next = code.replace(
      /\{\s*alias:\s*getAliases\(\)\s*\}/g,
      propertyReplacement,
    );
    return next === code ? null : next;
  };

  return {
    name: "pi-extension-loader-electron",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.includes("@earendil-works/pi-coding-agent")) return null;
      if (!normalized.includes("extensions/loader")) return null;
      const next = rewrite(code);
      return next ? { code: next, map: null } : null;
    },
    renderChunk(code) {
      const next = rewrite(code);
      return next ? { code: next, map: null } : null;
    },
  };
}
