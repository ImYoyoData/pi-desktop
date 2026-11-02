import type { ReactNode } from "react";

/**
 * OMP 品牌图标：omp.sh 顶栏的渐变 π 标记。
 * viewBox 取紧贴图形的方形画布（图形 44x42，上下各留 1 单位居中），
 * 与 Pi 标记同口径，两个图标在列表里大小与基线对齐。
 */
type Props = {
  size?: number;
};

export function OmpLogoIcon({ size = 16 }: Props): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="10 13 44 44"
      style={{ verticalAlign: "middle" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="omp-mark-grad"
          gradientUnits="userSpaceOnUse"
          x1="10"
          y1="14"
          x2="54"
          y2="56"
        >
          <stop offset="0" stopColor="oklch(0.7 0.24 340)" />
          <stop offset="0.5" stopColor="oklch(0.62 0.21 295)" />
          <stop offset="1" stopColor="oklch(0.81 0.14 200)" />
        </linearGradient>
      </defs>
      <path
        fill="url(#omp-mark-grad)"
        d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z"
      />
    </svg>
  );
}

export default OmpLogoIcon;
