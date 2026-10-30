import { type ReactNode } from "react";
import { Empty } from "antd";
import BrowserTab from "@renderer/components/BrowserTab";
import TabStrip from "@renderer/components/TabStrip";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./BrowserPage.module.css";

type Props = {
  visible: boolean;
};

/** 浏览器页：自带标签条，与文件页 / 更改页互斥。 */
export function BrowserPage({ visible }: Props): ReactNode {
  const t = useI18n();
  const rightTabs = useRightTabsStore();

  const browserTabs = rightTabs.dockTabs.filter((tab) => tab.kind === "browser");
  // 当前激活的是别的页面的标签时，浏览器页显示最后打开的那个。
  const activeId = browserTabs.some((tab) => tab.id === rightTabs.activeId)
    ? rightTabs.activeId
    : (browserTabs[browserTabs.length - 1]?.id ?? "");

  return (
    <div className={styles.root}>
      <TabStrip
        tabs={browserTabs}
        activeId={activeId}
        onAdd={() => useRightTabsStore.getState().addTab("browser")}
        addTitle={t.browser}
      />
      <div className={styles.panels}>
        {browserTabs.length === 0 ? (
          <Empty
            className={styles.empty}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t.browser}
          />
        ) : (
          browserTabs.map((tab) => (
            <div
              key={tab.id}
              className={styles.panel}
              style={tab.id === activeId ? undefined : { display: "none" }}
            >
              <BrowserTab
                tabId={tab.id}
                initialUrl={tab.url ?? null}
                visible={visible && tab.id === activeId}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default BrowserPage;
