import type { ReactNode } from "react";
import type { IoniconProps } from "@renderer/components/icons/ionicons";

/** 内置浏览器设置页图标：带地址栏的内置浏览器窗口。 */
export function BrowserIcon({ size = 16, className }: IoniconProps): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.65" y="2.65" width="12.7" height="10.7" rx="1.6" />
      <path d="M1.65 5.6h12.7" />
      <g fill="currentColor" stroke="none">
        <circle cx="3.9" cy="4.1" r="0.55" />
        <circle cx="5.75" cy="4.1" r="0.55" />
        <circle cx="7.6" cy="4.1" r="0.55" />
      </g>
    </svg>
  );
}

export default BrowserIcon;
