import type { ReactNode } from "react";

/**
 * Pi 的品牌标记：build/icon.svg 里的白色符号，去掉黑色底板。
 * viewBox 紧贴图形外框（469.43 见方），与 OMP 图标同口径紧裁剪，
 * 两个图标在列表里大小与基线对齐。
 */
type Props = {
  size?: number;
};

export function PiMarkIcon({ size = 16 }: Props): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="165.29 165.29 469.43 469.43"
      fill="currentColor"
      style={{ verticalAlign: "middle" }}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

export default PiMarkIcon;
