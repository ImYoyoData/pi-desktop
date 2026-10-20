import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { useDialog } from "@renderer/services/feedback";
import { handleAppLinkClick } from "@renderer/utils/open-link";
import styles from "./GitHubBody.module.css";

type Props = {
  html?: string;
  /** GitHub 图片 URL 白名单（来自详情 enrichment 的 images 映射）。 */
  images?: Record<string, string>;
  empty?: string;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function GitHubBody({ html = "", images = {}, empty = "" }: Props): ReactNode {
  const dialog = useDialog();
  const root = useRef<HTMLDivElement | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const sanitized = useMemo(
    () =>
      DOMPurify.sanitize(html ?? "", {
        ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
        ADD_ATTR: ["target", "rel"],
        FORBID_TAGS: ["style", "form", "input", "button"],
      }),
    [html],
  );

  const isEmpty = !html?.trim();

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const targets = Array.from(element.querySelectorAll("img"));
    void Promise.all(
      targets.map(async (img) => {
        const source = img.getAttribute("src") ?? "";
        const mapped = imagesRef.current[source] ?? source;
        if (!isHttpUrl(mapped) || img.dataset.githubImage === "1") return;
        img.dataset.githubImage = "1";
        const result = await window.api.github.image(mapped);
        if (result.success && img.isConnected) img.src = result.dataUrl;
      }),
    );
  }, [sanitized]);

  function onRootClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const anchor = target.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!isHttpUrl(href)) return;
    event.preventDefault();
    handleAppLinkClick(event.nativeEvent, href, dialog);
  }

  return (
    <div className={`github-body ${styles.root}`}>
      {isEmpty ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <div
          ref={root}
          className={styles.html}
          onClick={onRootClick}
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      )}
    </div>
  );
}

export default GitHubBody;
