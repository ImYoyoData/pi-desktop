import styles from "../Composer.module.css";

type Props = {
  hint: string;
  actionLabel: string;
  onAction: () => void;
};

/** 队列编辑 / 已发布消息重编辑时，输入框上方的提示条。 */
export function ComposerEditBanner({ hint, actionLabel, onAction }: Props) {
  return (
    <div className={styles.queueEditBanner}>
      <span>{hint}</span>
      <button type="button" className={styles.queueEditDiscard} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
