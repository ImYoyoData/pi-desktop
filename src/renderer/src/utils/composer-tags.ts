import type { ComposerChip } from "@renderer/stores/composer";
import { truncateElementContent } from "@renderer/stores/composer";
import { isRegionCitation } from "../../../shared/protocol";
import { t } from "@renderer/i18n";
import { fileTagLabel, urlTagLabel } from "@renderer/utils/path-label";

export { ellipsisMiddle, fileTagLabel, urlTagLabel } from "@renderer/utils/path-label";

/** Tag shown in composer / chat bubble — file tags use the relative path. */
export type ComposerAttachmentTag = {
  kind: "file" | "url" | "element";
  /** Display label (path for files). */
  label: string;
  /** Tooltip / secondary. */
  title: string;
  /** Element URL when kind=element; file path when kind=file; url when kind=url. */
  ref: string;
  content?: string;
};

export function chipsToAttachmentTags(chips: ComposerChip[]): ComposerAttachmentTag[] {
  const out: ComposerAttachmentTag[] = [];
  for (const chip of chips) {
    if (chip.kind === "file") {
      const range =
        chip.startLine && chip.endLine
          ? `:${chip.startLine}-${chip.endLine}`
          : chip.startLine
            ? `:${chip.startLine}`
            : "";
      out.push({
        kind: "file",
        label: `${fileTagLabel(chip.path)}${range}`,
        title: chip.path,
        ref: chip.path,
        content: chip.path,
      });
    } else if (chip.kind === "url") {
      out.push({
        kind: "url",
        label: urlTagLabel(chip.url),
        title: chip.url,
        ref: chip.url,
        content: chip.url,
      });
    } else {
      if (isRegionCitation(chip.citation)) {
        out.push({
          kind: "element",
          label: t.chipRegion,
          title: [chip.citation.url, chip.citation.text].filter(Boolean).join("\n"),
          ref: chip.citation.url,
          content: chip.citation.text,
        });
      } else {
        const content = truncateElementContent(chip.citation.text ?? "", 100);
        const label = content || chip.citation.selector?.trim() || t.chipElement;
        out.push({
          kind: "element",
          label,
          title: [chip.citation.url, chip.citation.selector, chip.citation.text]
            .filter(Boolean)
            .join("\n"),
          ref: chip.citation.url,
          content,
        });
      }
    }
  }
  return out;
}
