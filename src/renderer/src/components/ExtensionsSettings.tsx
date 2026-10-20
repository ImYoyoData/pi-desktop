import { useEffect, useState, type ReactNode } from "react";
import { Button, Empty, Modal, Space, Spin, Tag, Typography } from "antd";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import ToggleButton from "@renderer/components/ToggleButton";
import { useDialog, useMessage, type DialogHandle } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./ExtensionsSettings.module.css";

type PluginRow = {
  source: string;
  scope: "global" | "project";
  disabled: boolean;
  installedPath?: string;
  status: "loaded" | "installed" | "missing" | "disabled";
};

type Props = {
  open: boolean;
  onClose?: () => void;
};

function keyOf(p: PluginRow): string {
  return `${p.scope}\0${p.source}`;
}

function statusType(status: PluginRow["status"]): "default" | "success" | "warning" | "error" {
  switch (status) {
    case "loaded":
    case "installed":
      return "success";
    case "disabled":
      return "warning";
    case "missing":
      return "error";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function ExtensionsSettings({ open, onClose }: Props): ReactNode {
  const t = useI18n();
  const workspace = useWorkspaceStore();
  const message = useMessage();
  const dialog = useDialog();
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<PluginRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const data = await window.api.plugins.list(workspace.root ?? undefined);
      setPackages(data.packages);
      setSelected((current) => {
        if (current) return current;
        return data.packages.length ? keyOf(data.packages[0]) : null;
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const selectedPkg = packages.find((pkg) => keyOf(pkg) === selected) ?? null;

  async function onToggle(pkg: PluginRow, enabled: boolean): Promise<void> {
    setToggling(keyOf(pkg));
    try {
      const data = await window.api.plugins.setEnabled(
        pkg.source,
        pkg.scope,
        enabled,
        workspace.root ?? undefined,
      );
      setPackages(data.packages);
      message.success(enabled ? t.extensionEnabled : t.extensionDisabled);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(null);
    }
  }

  function onRemove(pkg: PluginRow): void {
    let d: DialogHandle;
    d = dialog.warning({
      title: t.extensionUninstallTitle,
      content: t.extensionUninstallConfirm(pkg.source, pkg.scope),
      positiveText: t.uninstall,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        setRemoving(true);
        return (async () => {
          try {
            const data = await window.api.plugins.remove(
              pkg.source,
              pkg.scope,
              workspace.root ?? undefined,
            );
            setPackages(data.packages);
            setSelected(data.packages[0] ? keyOf(data.packages[0]) : null);
            message.success(t.extensionUninstalled);
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          } finally {
            setRemoving(false);
          }
        })();
      },
    });
  }

  return (
    <Modal
      open={open}
      className="pi-settings-modal"
      width="min(860px, 94vw)"
      title={
        <div className={styles.headerTitle}>
          <span>{t.extensionsTitle}</span>
          <span className={styles.headerExtra}>pi packages</span>
        </div>
      }
      onCancel={() => onClose?.()}
      footer={
        <Space style={{ justifyContent: "flex-end" }}>
          <Button size="small" onClick={() => onClose?.()}>
            {t.close}
          </Button>
        </Space>
      }
    >
      <div className={styles.modalBody}>
        <Spin spinning={loading} className={styles.spinFill}>
          <div className={styles.layout}>
            <div className={styles.left}>
              {!packages.length ? (
                <Empty description={t.extensionsEmpty} style={{ padding: 24 }} />
              ) : (
                packages.map((pkg) => {
                  const key = keyOf(pkg);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={selected === key ? `${styles.row} ${styles.active}` : styles.row}
                      onClick={() => setSelected(key)}
                    >
                      <div className={styles.name}>{pkg.source}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {pkg.scope}
                      </Typography.Text>
                    </button>
                  );
                })
              )}
            </div>

            <div className={styles.right}>
              {selectedPkg ? (
                <>
                  <div className={styles.head}>
                    <div>
                      <div className={styles.title}>{selectedPkg.source}</div>
                      <Space size={8} style={{ marginTop: 4 }}>
                        <Tag
                          className={styles.tag}
                          color={statusType(selectedPkg.status)}
                          variant="filled"
                        >
                          {selectedPkg.status}
                        </Tag>
                        <Tag className={styles.tag} variant="filled">
                          {selectedPkg.scope}
                        </Tag>
                      </Space>
                    </div>
                    <ToggleButton
                      value={!selectedPkg.disabled}
                      loading={toggling === keyOf(selectedPkg)}
                      onValueChange={(value) => void onToggle(selectedPkg, value)}
                    />
                  </div>
                  {selectedPkg.installedPath ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {selectedPkg.installedPath}
                    </Typography.Text>
                  ) : null}
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", marginTop: 12, fontSize: 12 }}
                  >
                    {t.extensionsHint}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", marginTop: 8, fontSize: 11.5, lineHeight: 1.5 }}
                  >
                    {t.extensionsCapabilitiesNote}
                  </Typography.Text>
                  <div className={styles.danger}>
                    <Button
                      size="small"
                      danger
                      type="default"
                      loading={removing}
                      onClick={() => onRemove(selectedPkg)}
                    >
                      {t.extensionUninstall}
                    </Button>
                  </div>
                </>
              ) : (
                <Empty description={t.extensionSelect} />
              )}
            </div>
          </div>
        </Spin>
      </div>
    </Modal>
  );
}

export default ExtensionsSettings;
