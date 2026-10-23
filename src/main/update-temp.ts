import { rmSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/** 更新安装包缓存目录名，需与 app-update.ts 的下载目录一致。 */
export const UPDATE_TEMP_DIR_NAME = "pi-desktop-update";

/** 清理更新安装包缓存：更新完成后残留上百 MB，下次启动时清掉。 */
export function cleanupUpdateTempDir(): void {
	try {
		rmSync(join(app.getPath("temp"), UPDATE_TEMP_DIR_NAME), {
			recursive: true,
			force: true,
			maxRetries: 3,
		});
	} catch {
		// 安装包可能仍被安装器占用，清理失败不影响启动
	}
}
