/** omp CLI 探测结果（仅版本展示，不提供安装入口）。 */
export type OmpCliStatus = {
	installed: boolean;
	/** `omp --version` 解析出的版本号；命令存在但解析失败为 null。 */
	version: string | null;
};
