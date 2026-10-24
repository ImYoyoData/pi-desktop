/** 浏览器预览桥：外部浏览器通过这个端口访问 Electron 主进程。 */
export const DEV_BRIDGE_DEFAULT_PORT = 9223;

/**
 * 预览桥端口相对 Vite 端口的偏移：同一台机器上多个 dev 实例
 * 各自占用自己的端口，页面不会连到别的实例的主进程。
 */
export const DEV_BRIDGE_PORT_OFFSET = 10000;

/** 实例标识：页面用它确认连到的是自己的主进程。 */
export function devBridgeInstance(port: number): string {
	return `pi-desktop-${port}`;
}
