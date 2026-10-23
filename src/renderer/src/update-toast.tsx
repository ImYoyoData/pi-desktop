import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { UpdateProgress } from "./components/UpdateProgress";
import { antdLocaleFor, themeConfigFor } from "./theme/antd";
import { useAppearanceStore } from "./stores/appearance";
import { useUiLocale } from "./i18n/use-i18n";
import "./assets/main.css";
import "./assets/update-toast.css";

/** 悬浮窗复用应用的配色与字号，但不接管壁纸玻璃层（窗口本身就是透明的）。 */
function applyAppearance(): void {
	const { resolvedTheme, fontSize } = useAppearanceStore.getState();
	const root = document.documentElement;
	root.dataset.theme = resolvedTheme;
	root.style.colorScheme = resolvedTheme;
	root.style.fontSize = `${fontSize}px`;
}

applyAppearance();
useAppearanceStore.subscribe(applyAppearance);

function ToastRoot(): ReactNode {
	const theme = useAppearanceStore((s) => s.resolvedTheme);
	const fontSize = useAppearanceStore((s) => s.fontSize);
	const locale = useUiLocale();
	return (
		<ConfigProvider theme={themeConfigFor(theme, fontSize)} locale={antdLocaleFor(locale)}>
			<UpdateProgress />
		</ConfigProvider>
	);
}

const container = document.getElementById("app");
if (!container) throw new Error("挂载点 #app 不存在");
createRoot(container).render(<ToastRoot />);
