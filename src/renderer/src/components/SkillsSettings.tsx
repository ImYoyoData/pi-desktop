import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Empty, Modal, Spin, Typography } from "antd";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
  useDialog,
  useMessage,
  type DialogHandle,
} from "@renderer/services/feedback";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import ToggleButton from "@renderer/components/ToggleButton";
import styles from "./SkillsSettings.module.css";

type SkillRow = {
  name: string;
  description: string;
  filePath: string;
  source: string;
  scope: string;
  disableModelInvocation: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SkillsSettings({ open, onClose }: Props): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const dialog = useDialog();
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  const selectedSkill =
    skills.find((s) => s.filePath === selected) ?? null;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await window.api.skills.list(
        useWorkspaceStore.getState().root ?? undefined,
      );
      setSkills(data.skills);
      setSelected((current) => {
        if (current) return current;
        return data.skills[0]?.filePath ?? null;
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  async function onToggle(skill: SkillRow, enabled: boolean): Promise<void> {
    setToggling(skill.filePath);
    try {
      await window.api.skills.setDisabled(skill.filePath, !enabled);
      setSkills((list) =>
        list.map((item) =>
          item.filePath === skill.filePath
            ? { ...item, disableModelInvocation: !enabled }
            : item,
        ),
      );
      message.success(enabled ? t.skillEnabled : t.skillDisabledManual);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(null);
    }
  }

  function sourceLabel(skill: SkillRow): string {
    if (skill.scope === "project" || skill.source === "project") return "project";
    if (skill.scope === "user" || skill.source === "user") return "global";
    return skill.source || "path";
  }

  function canUninstall(skill: SkillRow): boolean {
    const scope = skill.scope || skill.source;
    return (
      scope === "user" || scope === "global" || scope === "project" || scope === "path"
    );
  }

  function onUninstall(skill: SkillRow): void {
    let d: DialogHandle;
    d = dialog.warning({
      title: t.skillUninstallTitle,
      content: t.skillUninstallConfirm(skill.name),
      positiveText: t.uninstall,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        setUninstalling(true);
        return (async () => {
          try {
            await window.api.skills.uninstall(
              skill.filePath,
              useWorkspaceStore.getState().root ?? undefined,
            );
            message.success(t.skillUninstalled);
            if (selected === skill.filePath) setSelected(null);
            await load();
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          } finally {
            setUninstalling(false);
          }
        })();
      },
    });
  }

  return (
    <Modal
      open={open}
      title={t.skillsTitle}
      className="pi-settings-modal"
      width="min(860px, 94vw)"
      onCancel={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button size="small" onClick={onClose}>
            {t.close}
          </Button>
        </div>
      }
    >
      <div className={styles.modalBody}>
        <Spin spinning={loading} className={styles.spinFill}>
          <div className={styles.layout}>
            <div className={styles.left}>
              {!skills.length ? (
                <Empty description={t.skillsEmpty} style={{ padding: 24 }} />
              ) : null}
              {skills.map((skill) => (
                <button
                  key={skill.filePath}
                  type="button"
                  className={`${styles.row} ${
                    selected === skill.filePath ? styles.rowActive : ""
                  }`}
                  onClick={() => setSelected(skill.filePath)}
                >
                  <div className={styles.name}>{skill.name}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {sourceLabel(skill)}
                  </Typography.Text>
                </button>
              ))}
            </div>

            <div className={styles.right}>
              {selectedSkill ? (
                <>
                  <div className={styles.head}>
                    <div>
                      <div className={styles.title}>{selectedSkill.name}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {sourceLabel(selectedSkill)}
                      </Typography.Text>
                    </div>
                    <ToggleButton
                      value={!selectedSkill.disableModelInvocation}
                      loading={toggling === selectedSkill.filePath}
                      onValueChange={(value) => void onToggle(selectedSkill, value)}
                    />
                  </div>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, display: "block", marginBottom: 10 }}
                  >
                    {selectedSkill.filePath}
                  </Typography.Text>
                  <p className={styles.desc}>{selectedSkill.description}</p>
                  {canUninstall(selectedSkill) ? (
                    <div className={styles.danger}>
                      <Button
                        size="small"
                        danger
                        variant="outlined"
                        loading={uninstalling}
                        onClick={() => onUninstall(selectedSkill)}
                      >
                        {t.skillUninstall}
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <Empty description={t.skillSelect} />
              )}
            </div>
          </div>
        </Spin>
      </div>
    </Modal>
  );
}

export default SkillsSettings;
