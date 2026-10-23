import type { ReactNode } from "react";
import styles from "./Icon.module.css";

export type IconName =
  | "plus"
  | "folder"
  | "folderOpen"
  | "chevron"
  | "settings"
  | "terminal"
  | "preview"
  | "browser"
  | "chat"
  | "trash"
  | "spark"
  | "panelLeft"
  | "panelRight"
  | "send"
  | "stop"
  | "refresh"
  | "back"
  | "forward"
  | "cursor"
  | "search"
  | "diff";

type Props = {
  name: IconName;
  size?: number;
};

const GLYPHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  folderOpen: (
    <>
      <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h4" />
      <path d="M3 13h16l2 6H7z" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </>
  ),
  preview: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  browser: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v5" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0z" />,
  trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />,
  spark: <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />,
  panelLeft: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  send: <path d="M5 12l14-7-7 14-2-5-5-2z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.3" />
      <path d="M21 4v6h-6" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  forward: <path d="M9 6l6 6-6 6" />,
  cursor: <path d="M4 4l7 16 2-6 6-2L4 4z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  diff: (
    <>
      <path d="M12 5v14M5 12h14" />
      <path d="M8 8h8M8 16h8" opacity="0" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8M9 12h6" />
    </>
  ),
};

export function Icon({ name, size = 16 }: Props): ReactNode {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  );
}

export default Icon;
