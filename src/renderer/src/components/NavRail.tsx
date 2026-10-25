import type { ReactNode } from "react";
import {
  ChatboxOutline,
  GitPullRequestOutline,
  SettingsOutline,
} from "@renderer/components/icons/ionicons";
import { useLayoutStore } from "@renderer/stores/layout";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./NavRail.module.css";

type RailItem = {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
};

function RailButton({ item }: { item: RailItem }): ReactNode {
  return (
    <button
      type="button"
      className={`${styles.btn} ${item.active ? styles.btnActive : ""}`}
      title={item.label}
      aria-label={item.label}
      aria-pressed={item.active}
      onClick={item.onClick}
    >
      {item.icon}
    </button>
  );
}

/** 编辑器区最大化时聊天列宽度为 0，先还原布局再切视图。 */
function showChatView(): void {
  const layout = useLayoutStore.getState();
  if (layout.editorMaximized) layout.toggleEditorMaximized();
  layout.showChat();
}

/** 最左侧导航栏：视图切换常驻，不随会话列表折叠。 */
export function NavRail(): ReactNode {
  const t = useI18n();
  const centerView = useLayoutStore((s) => s.centerView);

  const views: RailItem[] = [
    {
      key: "chat",
      label: t.sessions,
      icon: <ChatboxOutline size={18} />,
      active: centerView === "chat",
      onClick: showChatView,
    },
    {
      key: "pull-requests",
      label: t.pullRequests,
      icon: <GitPullRequestOutline size={18} />,
      active: centerView === "pull-requests",
      onClick: () => useLayoutStore.getState().showPullRequests(),
    },
  ];

  const settings: RailItem = {
    key: "settings",
    label: t.customizeSettings,
    icon: <SettingsOutline size={18} />,
    active: centerView === "customize",
    onClick: () => {
      const layout = useLayoutStore.getState();
      layout.openCustomize(layout.customizeSection);
    },
  };

  return (
    <nav className={styles.rail}>
      {views.map((item) => (
        <RailButton key={item.key} item={item} />
      ))}
      <div className={styles.spacer} />
      <RailButton item={settings} />
    </nav>
  );
}

export default NavRail;
