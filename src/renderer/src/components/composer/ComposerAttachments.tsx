import { Image } from "antd";
import type { ComposerImage } from "@renderer/stores/composer";
import styles from "../Composer.module.css";

type Props = {
  images: ComposerImage[];
  removeLabel: string;
  onRemove: (id: string) => void;
};

/** 图片附件条：与富文本分离，发送时作为模型图片。 */
export function ComposerAttachments({ images, removeLabel, onRemove }: Props) {
  if (!images.length) return null;
  return (
    <div className={styles.imageAttachments}>
      {images.map((img) => (
        <div key={img.id} className={`img-chip ${styles.imgChip}`}>
          <Image
            className={styles.imgPreview}
            src={img.previewUrl}
            alt=""
            preview={{ src: img.previewUrl }}
            styles={{
              root: { width: "100%", height: "100%" },
              image: { width: "100%", height: "100%", objectFit: "cover" },
            }}
          />
          <button
            type="button"
            className={styles.imgX}
            title={removeLabel}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(img.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
