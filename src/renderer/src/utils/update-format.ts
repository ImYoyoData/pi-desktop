/** 更新下载的体积、速度与剩余时间格式化。 */

const BYTE_UNITS = ["B", "KB", "MB", "GB"];

/** 把字节数格式化成可读体积，如 `12.3 MB`。 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	const digits = unit === 0 || value >= 100 ? 0 : 1;
	return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** 把字节/秒格式化成可读速度，如 `1.2 MB/s`。 */
export function formatSpeed(bytesPerSecond: number): string {
	return `${formatBytes(bytesPerSecond)}/s`;
}

/** 按剩余字节与当前速度估算剩余秒数，速度未知时返回 null。 */
export function etaSeconds(
	remaining: number,
	bytesPerSecond: number,
): number | null {
	if (!Number.isFinite(remaining) || remaining <= 0) return null;
	if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
	return Math.round(remaining / bytesPerSecond);
}
