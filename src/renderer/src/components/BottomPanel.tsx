import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Dropdown, Empty } from "antd";
import {
  AddOutline,
  ChevronDownOutline,
  CloseOutline,
  TerminalOutline,
} from "@renderer/components/icons/ionicons";
import type { TerminalShellOption } from "../../../shared/protocol";
import TerminalTab from "@renderer/components/TerminalTab";
import { useLayoutStore } from "@renderer/stores/layout";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { localizedTabLabel } from "@renderer/utils/right-tab-labels";
import { terminalShellLabel } from "@renderer/utils/terminal-shell-labels";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./BottomPanel.module.css";

export function BottomPanel(): ReactNode {
  const t = useI18n();
  const layout = useLayoutStore();
  const keybindings = useKeybindingsStore();
  const rightTabs = useRightTabsStore();
  const [shells, setShells] = useState<TerminalShellOption[]>([]);

  const active = rightTabs.activePanelTab;

  const shellOptions = useMemo(
    () =>
      shells.length < 2
        ? []
        : shells.map((shell) => ({
            key: shell.id,
            label: terminalShellLabel(shell),
          })),
    [shells],
  );

  function newTerminal(shellId?: string): void {
    const layoutState = useLayoutStore.getState();
    if (layoutState.bottomCollapsed) layoutState.toggleBottomCollapsed();
    useRightTabsStore.getState().addTab("terminal", {
      cwd: useWorkspaceStore.getState().root ?? undefined,
      shellId,
    });
  }

  function onShellSelect(key: string): void {
    newTerminal(key);
  }

  function closeActiveTerminal(): void {
    const tabs = useRightTabsStore.getState();
    const tab = tabs.activePanelTab;
    if (tab?.kind === "terminal") {
      tabs.closeTab(tab.id);
      return;
    }
    const layoutState = useLayoutStore.getState();
    if (!layoutState.bottomCollapsed) layoutState.toggleBottomCollapsed();
  }

  useEffect(() => {
    keybindings.register("new-terminal", () => newTerminal());
    keybindings.register("close-terminal", closeActiveTerminal);
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const list = await window.api.terminal.listShells();
        if (!cancelled) setShells(list);
      } catch {
        if (!cancelled) setShells([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
      keybindings.unregister("new-terminal");
      keybindings.unregister("close-terminal");
    };
  }, []);

  useEffect(() => {
    if (!layout.bottomCollapsed && !rightTabs.panelTabs.length) newTerminal();
  }, [layout.bottomCollapsed]);

  return (
    <section className={styles.bottomPanel}>
      <header className={styles.panelHead}>
        <div className={styles.panelTabs}>
          {rightTabs.panelTabs.map((tab) => (
            <div
              key={tab.id}
              className={
                tab.id === rightTabs.panelActiveId
                  ? `${styles.panelTab} ${styles.active}`
                  : styles.panelTab
              }
              role="tab"
              aria-selected={tab.id === rightTabs.panelActiveId}
              data-id={tab.id}
              onClick={() => rightTabs.selectPanelTab(tab.id)}
            >
              <TerminalOutline size={12} />
              <span className={styles.panelTabLabel}>{localizedTabLabel(tab)}</span>
              <button
                type="button"
                className={styles.panelTabClose}
                title={t.closeTab}
                onClick={(event) => {
                  event.stopPropagation();
                  rightTabs.closeTab(tab.id);
                }}
              >
                <CloseOutline size={12} />
              </button>
            </div>
          ))}
        </div>

        {shellOptions.length ? (
          <Dropdown
            trigger={["click"]}
            menu={{ items: shellOptions, onClick: ({ key }) => onShellSelect(key) }}
          >
            <Button
              type="text"
              shape="circle"
              size="small"
              className="pi-interactive"
              title={t.terminalPickShell}
              icon={<AddOutline size={14} />}
            />
          </Dropdown>
        ) : (
          <Button
            type="text"
            shape="circle"
            size="small"
            className="pi-interactive"
            title={t.newTerminal}
            onClick={() => newTerminal()}
            icon={<AddOutline size={14} />}
          />
        )}
        <Button
          type="text"
          shape="circle"
          size="small"
          className="pi-interactive"
          title={t.collapseBottom}
          onClick={() => layout.toggleBottomCollapsed()}
          icon={<ChevronDownOutline size={14} />}
        />
      </header>

      <div className={styles.panelBody}>
        {rightTabs.panelTabs.map((tab) => (
          <div
            key={tab.id}
            className={styles.panelTerm}
            style={{ display: tab.id === active?.id ? undefined : "none" }}
          >
            <TerminalTab
              instanceId={tab.id}
              ptyId={tab.ptyId ?? null}
              cwd={tab.cwd ?? null}
              shellId={tab.shellId ?? null}
              visible={tab.id === active?.id && !layout.bottomCollapsed}
            />
          </div>
        ))}
        {rightTabs.panelTabs.length ? null : (
          <Empty
            className={styles.panelEmpty}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t.terminalEmptyHint}
          >
            <Button
              size="small"
              className="pi-interactive"
              onClick={() => newTerminal()}
              icon={<AddOutline size={14} />}
            >
              {t.newTerminal}
            </Button>
          </Empty>
        )}
      </div>
    </section>
  );
}

export default BottomPanel;
