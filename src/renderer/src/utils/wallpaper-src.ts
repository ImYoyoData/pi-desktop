import { wallpaperMediaSrc } from "../../../shared/appearance";
import { DEV_BRIDGE_DEFAULT_PORT } from "../../../shared/dev-bridge";

/**
 * 壁纸媒体地址：桌面端走 pi-media 协议，
 * 外部浏览器预览时改走开发桥的本地文件端点，浏览器才读得到图片。
 */
export function wallpaperSrc(filePath: string): string {
	if (window.__piBrowserPreview) {
		const origin =
			window.__piBridgeOrigin ?? `http://127.0.0.1:${DEV_BRIDGE_DEFAULT_PORT}`;
		return `${origin}/media?p=${encodeURIComponent(filePath)}`;
	}
	return wallpaperMediaSrc(filePath);
}
