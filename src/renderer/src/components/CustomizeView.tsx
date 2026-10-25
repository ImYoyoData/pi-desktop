import { useEffect, type ReactNode } from "react";
import AiCustomizationPage from "@renderer/components/AiCustomizationPage";
import { useLayoutStore } from "@renderer/stores/layout";
import { hasOpenModal } from "@renderer/utils/modal-overlay";

/** 设置页作为主区独立页面：Esc 返回会话，页面内模态优先消费 Esc。 */
export function CustomizeView(): ReactNode {
  const section = useLayoutStore((s) => s.customizeSection);

  useEffect(() => {
    function onWindowKeydown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (hasOpenModal() || document.querySelector(".ant-modal-mask")) return;
      useLayoutStore.getState().showChat();
    }

    window.addEventListener("keydown", onWindowKeydown);
    return () => window.removeEventListener("keydown", onWindowKeydown);
  }, []);

  return (
    <div className="customize-page">
      <AiCustomizationPage section={section} visible />
    </div>
  );
}

export default CustomizeView;
