import type { ReactNode } from "react";

/** VS Code codicon layout-panel；off 为隐藏态。 */
type Props = {
  size?: number;
  off?: boolean;
};

export function PanelBottomIcon({ size = 16, off = false }: Props): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      {off ? (
        <path d="M12.5 1H3.5C2.122 1 1 2.121 1 3.5V12.5C1 13.879 2.122 15 3.5 15H12.5C13.878 15 15 13.879 15 12.5V3.5C15 2.121 13.878 1 12.5 1ZM14 12.5C14 13.327 13.327 14 12.5 14H3.5C2.673 14 2 13.327 2 12.5V11H14V12.5ZM14 10H2V3.5C2 2.673 2.673 2 3.5 2H12.5C13.327 2 14 2.673 14 3.5V10Z" />
      ) : (
        <path d="M15 12.5C15 13.881 13.881 15 12.5 15H3.5C2.119 15 1 13.881 1 12.5V3.5C1 2.119 2.119 1 3.5 1H12.5C13.881 1 15 2.119 15 3.5V12.5ZM2 10H14V3.5C14 2.672 13.328 2 12.5 2H3.5C2.672 2 2 2.672 2 3.5V10Z" />
      )}
    </svg>
  );
}

export default PanelBottomIcon;
