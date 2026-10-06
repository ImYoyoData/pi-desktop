/** IPC 参数含 Vue 响应式 Proxy 时结构化克隆会失败（An object could not be cloned.），统一转纯数据。 */
export function plainIpcArgs<T>(value: T): T {
	if (value === undefined || value === null) return value;
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return value;
	}
}
