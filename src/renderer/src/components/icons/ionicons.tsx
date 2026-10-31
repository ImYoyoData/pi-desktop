import type { CSSProperties, ReactNode } from "react";

export type IoniconProps = {
  /** 尺寸：数字按 px 处理，字符串原样透传（如 "1em"）。 */
  size?: number | string;
  color?: string;
  className?: string;
  style?: CSSProperties;
};


export function AddOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M256 112v288"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M400 256H112"} />
    </svg>
  );
}

export function ArchiveOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M80 152v256a40.12 40.12 0 0 0 40 40h272a40.12 40.12 0 0 0 40-40V152"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <rect x={48} y={64} width={416} height={80} rx={28} ry={28} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M320 304l-64 64l-64-64"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M256 345.89V224"} />
    </svg>
  );
}

export function ArrowBackOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M244 400L100 256l144-144"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M120 256h292"} />
    </svg>
  );
}

export function ArrowDownOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M112 268l144 144l144-144"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M256 392V100"} />
    </svg>
  );
}

export function ArrowForwardOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M268 112l144 144l-144 144"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M392 256H100"} />
    </svg>
  );
}

export function ArrowUndoOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M240 424v-96c116.4 0 159.39 33.76 208 96c0-119.23-39.57-240-208-240V88L64 256z"} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function ArrowUpCircleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M176 249.38L256 170l80 79.38"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M256 181.03V342"} />
      <path d={"M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192s192-86 192-192z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function BookmarkOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M352 48H160a48 48 0 0 0-48 48v368l144-128l144 128V96a48 48 0 0 0-48-48z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function ChatboxOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M408 64H104a56.16 56.16 0 0 0-56 56v192a56.16 56.16 0 0 0 56 56h40v80l93.72-78.14a8 8 0 0 1 5.13-1.86H408a56.16 56.16 0 0 0 56-56V120a56.16 56.16 0 0 0-56-56z"} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function ChatbubbleEllipsesOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M87.48 380c1.2-4.38-1.43-10.47-3.94-14.86a42.63 42.63 0 0 0-2.54-3.8a199.81 199.81 0 0 1-33-110C47.64 139.09 140.72 48 255.82 48C356.2 48 440 117.54 459.57 209.85a199 199 0 0 1 4.43 41.64c0 112.41-89.49 204.93-204.59 204.93c-18.31 0-43-4.6-56.47-8.37s-26.92-8.77-30.39-10.11a31.14 31.14 0 0 0-11.13-2.07a30.7 30.7 0 0 0-12.08 2.43L81.5 462.78a15.92 15.92 0 0 1-4.66 1.22a9.61 9.61 0 0 1-9.58-9.74a15.85 15.85 0 0 1 .6-3.29z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} />
      <circle cx={160} cy={256} r={32} fill={"currentColor"} />
      <circle cx={256} cy={256} r={32} fill={"currentColor"} />
      <circle cx={352} cy={256} r={32} fill={"currentColor"} />
    </svg>
  );
}

export function ChatbubbleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M87.49 380c1.19-4.38-1.44-10.47-3.95-14.86a44.86 44.86 0 0 0-2.54-3.8a199.81 199.81 0 0 1-33-110C47.65 139.09 140.73 48 255.83 48C356.21 48 440 117.54 459.58 209.85a199 199 0 0 1 4.42 41.64c0 112.41-89.49 204.93-204.59 204.93c-18.3 0-43-4.6-56.47-8.37s-26.92-8.77-30.39-10.11a31.09 31.09 0 0 0-11.12-2.07a30.71 30.71 0 0 0-12.09 2.43l-67.83 24.48a16 16 0 0 1-4.67 1.22a9.6 9.6 0 0 1-9.57-9.74a15.85 15.85 0 0 1 .6-3.29z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function CheckmarkCircle({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M256 48C141.31 48 48 141.31 48 256s93.31 208 208 208s208-93.31 208-208S370.69 48 256 48zm108.25 138.29l-134.4 160a16 16 0 0 1-12 5.71h-.27a16 16 0 0 1-11.89-5.3l-57.6-64a16 16 0 1 1 23.78-21.4l45.29 50.32l122.59-145.91a16 16 0 0 1 24.5 20.58z"} fill={"currentColor"} />
    </svg>
  );
}

export function CheckmarkCircleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192s192-86 192-192z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M352 176L217.6 336L160 272"} />
    </svg>
  );
}

export function CheckmarkOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M416 128L192 384l-96-96"} />
    </svg>
  );
}

export function ChevronBackOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M328 112L184 256l144 144"} />
    </svg>
  );
}

export function ChevronDownOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M112 184l144 144l144-144"} />
    </svg>
  );
}

export function ChevronForwardOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M184 112l144 144l-144 144"} />
    </svg>
  );
}

export function ChevronUpOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={48} d={"M112 328l144-144l144 144"} />
    </svg>
  );
}

export function CloseCircleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192s192-86 192-192z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M320 320L192 192"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M192 320l128-128"} />
    </svg>
  );
}

export function CloseOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M368 368L144 144"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M368 144L144 368"} />
    </svg>
  );
}

export function CodeSlashOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M160 368L32 256l128-112"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M352 368l128-112l-128-112"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M304 96l-96 320"} />
    </svg>
  );
}

export function ContractOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <polyline points={"304 416 304 304 416 304"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={314.2} y1={314.23} x2={432} y2={432} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"208 96 208 208 96 208"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={197.8} y1={197.77} x2={80} y2={80} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"416 208 304 208 304 96"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={314.23} y1={197.8} x2={432} y2={80} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"96 304 208 304 208 416"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={197.77} y1={314.2} x2={80} y2={432} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function CopyOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <rect x={128} y={128} width={336} height={336} rx={57} ry={57} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M383.5 128l.5-24a56.16 56.16 0 0 0-56-56H112a64.19 64.19 0 0 0-64 64v216a56.16 56.16 0 0 0 56 56h24"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function CreateOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M384 224v184a40 40 0 0 1-40 40H104a40 40 0 0 1-40-40V168a40 40 0 0 1 40-40h167.48"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M459.94 53.25a16.06 16.06 0 0 0-23.22-.56L424.35 65a8 8 0 0 0 0 11.31l11.34 11.32a8 8 0 0 0 11.34 0l12.06-12c6.1-6.09 6.67-16.01.85-22.38z"} fill={"currentColor"} />
      <path d={"M399.34 90L218.82 270.2a9 9 0 0 0-2.31 3.93L208.16 299a3.91 3.91 0 0 0 4.86 4.86l24.85-8.35a9 9 0 0 0 3.93-2.31L422 112.66a9 9 0 0 0 0-12.66l-9.95-10a9 9 0 0 0-12.71 0z"} fill={"currentColor"} />
    </svg>
  );
}

export function DocumentAttachOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M208 64h66.75a32 32 0 0 1 22.62 9.37l141.26 141.26a32 32 0 0 1 9.37 22.62V432a48 48 0 0 1-48 48H192a48 48 0 0 1-48-48V304"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M288 72v120a32 32 0 0 0 32 32h120"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M160 80v152a23.69 23.69 0 0 1-24 24c-12 0-24-9.1-24-24V88c0-30.59 16.57-56 48-56s48 24.8 48 55.38v138.75c0 43-27.82 77.87-72 77.87s-72-34.86-72-77.87V144"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function DocumentOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M416 221.25V416a48 48 0 0 1-48 48H144a48 48 0 0 1-48-48V96a48 48 0 0 1 48-48h98.75a32 32 0 0 1 22.62 9.37l141.26 141.26a32 32 0 0 1 9.37 22.62z"} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M256 56v120a32 32 0 0 0 32 32h120"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function DocumentTextOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M416 221.25V416a48 48 0 0 1-48 48H144a48 48 0 0 1-48-48V96a48 48 0 0 1 48-48h98.75a32 32 0 0 1 22.62 9.37l141.26 141.26a32 32 0 0 1 9.37 22.62z"} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M256 56v120a32 32 0 0 0 32 32h120"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M176 288h160"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M176 368h160"} />
    </svg>
  );
}

export function DownloadOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M256 96v224"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M144 256l112 112 112-112"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M112 416h288"} />
    </svg>
  );
}

export function EarthOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M464,256c0-114.87-93.13-208-208-208S48,141.13,48,256s93.13,208,208,208S464,370.87,464,256Z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path d={"M445.57,172.14c-16.06.1-14.48,29.73-34.49,15.75-7.43-5.18-12-12.71-21.33-15-8.15-2-16.5.08-24.55,1.47-9.15,1.58-20,2.29-26.94,9.22-6.71,6.67-10.26,15.62-17.4,22.33-13.81,13-19.64,27.19-10.7,45.57,8.6,17.67,26.59,27.26,46,26,19.07-1.27,38.88-12.33,38.33,15.38-.2,9.8,1.85,16.6,4.86,25.71,2.79,8.4,2.6,16.54,3.24,25.21,1.18,16.2,4.16,34.36,12.2,48.67l15-21.16c1.85-2.62,5.72-6.29,6.64-9.38,1.63-5.47-1.58-14.87-1.95-21s-.19-12.34-1.13-18.47c-1.32-8.59-6.4-16.64-7.1-25.13-1.29-15.81,1.6-28.43-10.58-41.65-11.76-12.75-29-15.81-45.47-13.22-8.3,1.3-41.71,6.64-28.3-12.33,2.65-3.73,7.28-6.79,10.26-10.34,2.59-3.09,4.84-8.77,7.88-11.18s17-5.18,21-3.95,8.17,7,11.64,9.56a49.89,49.89,0,0,0,21.81,9.36c13.66,2,42.22-5.94,42-23.46C456.45,191.7,448.65,180,445.57,172.14Z"} />
      <path d={"M287.45,316.3c-5.33-22.44-35.82-29.94-52.26-42.11-9.45-7-17.86-17.81-30.27-18.69-5.72-.41-10.51.83-16.18-.64-5.2-1.34-9.28-4.14-14.82-3.41-10.35,1.36-16.88,12.42-28,10.92-10.55-1.42-21.42-13.76-23.82-23.81-3.08-12.92,7.14-17.11,18.09-18.26,4.57-.48,9.7-1,14.09.67,5.78,2.15,8.51,7.81,13.7,10.67,9.73,5.33,11.7-3.19,10.21-11.83-2.23-12.94-4.83-18.22,6.71-27.12,8-6.14,14.84-10.58,13.56-21.61-.76-6.48-4.31-9.41-1-15.86,2.51-4.91,9.4-9.34,13.89-12.27,11.59-7.56,49.65-7,34.1-28.16-4.57-6.21-13-17.31-21-18.83-10-1.89-14.44,9.27-21.41,14.19-7.2,5.09-21.22,10.87-28.43,3-9.7-10.59,6.43-14.07,10-21.46S176.34,70.33,170,66.79l-29.81,33.43a41.52,41.52,0,0,0,8.34,31.86c5.93,7.63,15.37,10.08,15.8,20.5.42,10-1.14,15.12-7.68,22.15-2.83,3-4.83,7.26-7.71,10.07-3.53,3.43-2.22,2.38-7.73,3.32-10.36,1.75-19.18,4.45-29.19,7.21C95.34,199.94,93.8,172.69,86.2,162l-25,20.19c-.27,3.31,4.1,9.4,5.29,13C73.32,215.76,87.1,231.67,96,251.35c9.37,20.84,34.53,15.06,45.64,33.32,9.86,16.2-.67,36.71,6.71,53.67,5.36,12.31,18,15,26.72,24,8.91,9.09,8.72,21.53,10.08,33.36a305.22,305.22,0,0,0,7.45,41.28c1.21,4.69,2.32,10.89,5.53,14.76,2.2,2.66,9.75,4.95,6.7,5.83,4.26.7,11.85,4.68,15.4,1.76,4.68-3.84,3.43-15.66,4.24-21,2.43-15.9,10.39-31.45,21.13-43.35,10.61-11.74,25.15-19.69,34.11-33C288.44,349,291.07,331.49,287.45,316.3Zm-33.39,26.32c-6,10.71-19.36,17.88-27.95,26.39-2.33,2.31-7.29,10.31-10.21,8.58-2.09-1.24-2.8-11.62-3.57-14a61.17,61.17,0,0,0-21.71-29.95c-3.13-2.37-10.89-5.45-12.68-8.7-2-3.53-.2-11.86-.13-15.7.11-5.6-2.44-14.91-1.06-20,1.6-5.87-1.48-2.33,3.77-3.49,2.77-.62,14.21,1.39,17.66,2.11,5.48,1.14,8.5,4.55,12.82,8,11.36,9.11,23.87,16.16,36.6,23.14C257.46,324.46,260.36,331.37,254.06,342.62Z"} />
      <path d={"M184.46,67.09c4.74,4.63,9.2,10.11,16.27,10.57,6.69.45,13-3.17,18.84,1.38,6.48,5,11.15,11.33,19.75,12.89,8.32,1.51,17.13-3.35,19.19-11.86,2-8.11-2.31-16.93-2.57-25.07,0-1.13.61-6.15-.17-7-.58-.64-5.42.08-6.16.1q-8.13.24-16.22,1.12a207.1,207.1,0,0,0-57.18,14.65C178.64,65.55,181.69,66.22,184.46,67.09Z"} />
      <path d={"M356.4,123.27c8.49,0,17.11-3.8,14.37-13.62-2.3-8.23-6.22-17.16-15.76-12.72-6.07,2.82-14.67,10-15.38,17.12C338.82,122.13,350.74,123.27,356.4,123.27Z"} />
      <path d={"M349.62,166.24c8.67,5.19,21.53,2.75,28.07-4.66,5.11-5.8,8.12-15.87,17.31-15.86a15.4,15.4,0,0,1,10.82,4.41c3.8,3.93,3.05,7.62,3.86,12.54,1.81,11.05,13.66.63,16.75-3.65,2-2.79,4.71-6.93,3.8-10.56-.84-3.39-4.8-7-6.56-10.11-5.14-9-9.37-19.47-17.07-26.74-7.41-7-16.52-6.19-23.55,1.08-5.76,6-12.45,10.75-16.39,18.05-2.78,5.13-5.91,7.58-11.54,8.91-3.1.73-6.64,1-9.24,3.08C338.64,148.43,342.76,162.12,349.62,166.24Z"} />
    </svg>
  );
}

export function EllipseOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <circle cx={256} cy={256} r={192} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function EllipsisHorizontalOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <circle cx={256} cy={256} r={32} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <circle cx={416} cy={256} r={32} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <circle cx={96} cy={256} r={32} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function ExpandOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <polyline points={"432 320 432 432 320 432"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={421.8} y1={421.77} x2={304} y2={304} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"80 192 80 80 192 80"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={90.2} y1={90.23} x2={208} y2={208} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"320 80 432 80 432 192"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={421.77} y1={90.2} x2={304} y2={208} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"192 432 80 432 80 320"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={90.23} y1={421.8} x2={208} y2={304} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function ExtensionPuzzleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M413.66 246.1H386a2 2 0 0 1-2-2v-77.24A38.86 38.86 0 0 0 345.14 128H267.9a2 2 0 0 1-2-2V98.34c0-27.14-21.5-49.86-48.64-50.33a49.53 49.53 0 0 0-50.4 49.51V126a2 2 0 0 1-2 2H87.62A39.74 39.74 0 0 0 48 167.62V238a2 2 0 0 0 2 2h26.91c29.37 0 53.68 25.48 54.09 54.85c.42 29.87-23.51 57.15-53.29 57.15H50a2 2 0 0 0-2 2v70.38A39.74 39.74 0 0 0 87.62 464H158a2 2 0 0 0 2-2v-20.93c0-30.28 24.75-56.35 55-57.06c30.1-.7 57 20.31 57 50.28V462a2 2 0 0 0 2 2h71.14A38.86 38.86 0 0 0 384 425.14v-78a2 2 0 0 1 2-2h28.48c27.63 0 49.52-22.67 49.52-50.4s-23.2-48.64-50.34-48.64z"} />
    </svg>
  );
}

export function EyeOffOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M432,448a15.92,15.92,0,0,1-11.31-4.69l-352-352A16,16,0,0,1,91.31,68.69l352,352A16,16,0,0,1,432,448Z"} />
      <path d={"M255.66,384c-41.49,0-81.5-12.28-118.92-36.5-34.07-22-64.74-53.51-88.7-91l0-.08c19.94-28.57,41.78-52.73,65.24-72.21a2,2,0,0,0,.14-2.94L93.5,161.38a2,2,0,0,0-2.71-.12c-24.92,21-48.05,46.76-69.08,76.92a31.92,31.92,0,0,0-.64,35.54c26.41,41.33,60.4,76.14,98.28,100.65C162,402,207.9,416,255.66,416a239.13,239.13,0,0,0,75.8-12.58,2,2,0,0,0,.77-3.31l-21.58-21.58a4,4,0,0,0-3.83-1A204.8,204.8,0,0,1,255.66,384Z"} />
      <path d={"M490.84,238.6c-26.46-40.92-60.79-75.68-99.27-100.53C349,110.55,302,96,255.66,96a227.34,227.34,0,0,0-74.89,12.83,2,2,0,0,0-.75,3.31l21.55,21.55a4,4,0,0,0,3.88,1A192.82,192.82,0,0,1,255.66,128c40.69,0,80.58,12.43,118.55,37,34.71,22.4,65.74,53.88,89.76,91a.13.13,0,0,1,0,.16,310.72,310.72,0,0,1-64.12,72.73,2,2,0,0,0-.15,2.95l19.9,19.89a2,2,0,0,0,2.7.13,343.49,343.49,0,0,0,68.64-78.48A32.2,32.2,0,0,0,490.84,238.6Z"} />
      <path d={"M256,160a95.88,95.88,0,0,0-21.37,2.4,2,2,0,0,0-1,3.38L346.22,278.34a2,2,0,0,0,3.38-1A96,96,0,0,0,256,160Z"} />
      <path d={"M165.78,233.66a2,2,0,0,0-3.38,1,96,96,0,0,0,115,115,2,2,0,0,0,1-3.38Z"} />
    </svg>
  );
}

export function EyeOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M255.66 112c-77.94 0-157.89 45.11-220.83 135.33a16 16 0 0 0-.27 17.77C82.92 340.8 161.8 400 255.66 400c92.84 0 173.34-59.38 221.79-135.25a16.14 16.14 0 0 0 0-17.47C428.89 172.28 347.8 112 255.66 112z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={256} cy={256} r={80} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function FileTrayFullOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M384,80H128c-26,0-43,14-48,40L48,272V384a48.14,48.14,0,0,0,48,48H416a48.14,48.14,0,0,0,48-48V272L432,120C427,93,409,80,384,80Z"} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={48} y1={272} x2={192} y2={272} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={320} y1={272} x2={464} y2={272} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M192,272a64,64,0,0,0,128,0"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={144} y1={144} x2={368} y2={144} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={128} y1={208} x2={384} y2={208} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function FlagOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M80 464V68.14a8 8 0 0 1 4-6.9C91.81 56.66 112.92 48 160 48c64 0 145 48 192 48a199.53 199.53 0 0 0 77.23-15.77a2 2 0 0 1 2.77 1.85v219.36a4 4 0 0 1-2.39 3.65C421.37 308.7 392.33 320 352 320c-48 0-128-32-192-32s-80 16-80 16"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function FolderOpenOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M64 192v-72a40 40 0 0 1 40-40h75.89a40 40 0 0 1 22.19 6.72l27.84 18.56a40 40 0 0 0 22.19 6.72H408a40 40 0 0 1 40 40v40"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M479.9 226.55L463.68 392a40 40 0 0 1-39.93 40H88.25a40 40 0 0 1-39.93-40L32.1 226.55A32 32 0 0 1 64 192h384.1a32 32 0 0 1 31.8 34.55z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function FolderOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M440 432H72a40 40 0 0 1-40-40V120a40 40 0 0 1 40-40h75.89a40 40 0 0 1 22.19 6.72l27.84 18.56a40 40 0 0 0 22.19 6.72H440a40 40 0 0 1 40 40v240a40 40 0 0 1-40 40z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M32 192h448"} />
    </svg>
  );
}

export function GitBranchOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <circle cx={160} cy={96} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={160} cy={416} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={160} y1={368} x2={160} y2={144} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={352} cy={160} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M352,208c0,128-192,48-192,160"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function GitCommitOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <circle cx={256} cy={256} r={96} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M160 256H48"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M464 256H352"} />
    </svg>
  );
}

export function GitCompareOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <polyline points={"304 160 240 96 304 32"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"207 352 271 416 207 480"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={112} cy={96} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={400} cy={416} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M256,96h84a60,60,0,0,1,60,60V368"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M255,416H171a60,60,0,0,1-60-60V144"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function GitMerge({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M385 224a64 64 0 0 0-55.33 31.89c-42.23-1.21-85.19-12.72-116.21-31.33c-32.2-19.32-49.71-44-52.15-73.35a64 64 0 1 0-64.31.18v209.22a64 64 0 1 0 64 0v-94.46c44.76 34 107.28 52.38 168.56 53.76A64 64 0 1 0 385 224zM129 64a32 32 0 1 1-32 32a32 32 0 0 1 32-32zm0 384a32 32 0 1 1 32-32a32 32 0 0 1-32 32zm256-128a32 32 0 1 1 32-32a32 32 0 0 1-32 32z"} fill={"currentColor"} />
    </svg>
  );
}

export function GitPullRequestOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <circle cx={128} cy={416} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={128} y1={144} x2={128} y2={368} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <polyline points={"288 160 224 96 288 32"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={128} cy={96} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={384} cy={416} r={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M240,96h84a60,60,0,0,1,60,60V368"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function GlobeOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M256,48C141.13,48,48,141.13,48,256s93.13,208,208,208,208-93.13,208-208S370.87,48,256,48Z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path d={"M256,48c-58.07,0-112.67,93.13-112.67,208S197.93,464,256,464s112.67-93.13,112.67-208S314.07,48,256,48Z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path d={"M117.33,117.33c38.24,27.15,86.38,43.34,138.67,43.34s100.43-16.19,138.67-43.34"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M394.67,394.67c-38.24-27.15-86.38-43.34-138.67-43.34s-100.43,16.19-138.67,43.34"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={256} y1={48} x2={256} y2={464} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <line x1={464} y1={256} x2={48} y2={256} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function HardwareChipOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <rect x={80} y={80} width={352} height={352} rx={48} ry={48} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <rect x={144} y={144} width={224} height={224} rx={16} ry={16} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={256} y1={80} x2={256} y2={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={336} y1={80} x2={336} y2={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={176} y1={80} x2={176} y2={48} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={256} y1={464} x2={256} y2={432} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={336} y1={464} x2={336} y2={432} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={176} y1={464} x2={176} y2={432} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={432} y1={256} x2={464} y2={256} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={432} y1={336} x2={464} y2={336} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={432} y1={176} x2={464} y2={176} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={48} y1={256} x2={80} y2={256} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={48} y1={336} x2={80} y2={336} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={48} y1={176} x2={80} y2={176} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function HomeOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} d={"M32 264L256 40l224 224"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} d={"M88 208V420a52 52 0 0052 52h232a52 52 0 0052-52V208"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} d={"M212 472v-62a44 44 0 0188 0v62"} />
    </svg>
  );
}

export function InformationCircleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M248 64C146.39 64 64 146.39 64 248s82.39 184 184 184s184-82.39 184-184S349.61 64 248 64z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M220 220h32v116"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} d={"M208 340h88"} />
      <path d={"M248 130a26 26 0 1 0 26 26a26 26 0 0 0-26-26z"} fill={"currentColor"} />
    </svg>
  );
}

export function LibraryOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <rect x={32} y={96} width={64} height={368} rx={16} ry={16} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={112} y1={224} x2={240} y2={224} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={112} y1={400} x2={240} y2={400} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <rect x={112} y={160} width={128} height={304} rx={16} ry={16} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <rect x={256} y={48} width={96} height={416} rx={16} ry={16} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M422.46,96.11l-40.4,4.25c-11.12,1.17-19.18,11.57-17.93,23.1l34.92,321.59c1.26,11.53,11.37,20,22.49,18.84l40.4-4.25c11.12-1.17,19.18-11.57,17.93-23.1L445,115C443.69,103.42,433.58,94.94,422.46,96.11Z"} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function LinkOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M208 352h-64a96 96 0 0 1 0-192h64"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={36} />
      <path d={"M304 160h64a96 96 0 0 1 0 192h-64"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={36} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={36} d={"M163.29 256h187.42"} />
    </svg>
  );
}

export function ListOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <line x1={160} y1={144} x2={448} y2={144} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={160} y1={256} x2={448} y2={256} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={160} y1={368} x2={448} y2={368} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={80} cy={144} r={16} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={80} cy={256} r={16} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <circle cx={80} cy={368} r={16} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function LogoGithub({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M256 32C132.3 32 32 134.9 32 261.7c0 101.5 64.2 187.5 153.2 217.9a17.56 17.56 0 0 0 3.8.4c8.3 0 11.5-6.1 11.5-11.4c0-5.5-.2-19.9-.3-39.1a102.4 102.4 0 0 1-22.6 2.7c-43.1 0-52.9-33.5-52.9-33.5c-10.2-26.5-24.9-33.6-24.9-33.6c-19.5-13.7-.1-14.1 1.4-14.1h.1c22.5 2 34.3 23.8 34.3 23.8c11.2 19.6 26.2 25.1 39.6 25.1a63 63 0 0 0 25.6-6c2-14.8 7.8-24.9 14.2-30.7c-49.7-5.8-102-25.5-102-113.5c0-25.1 8.7-45.6 23-61.6c-2.3-5.8-10-29.2 2.2-60.8a18.64 18.64 0 0 1 5-.5c8.1 0 26.4 3.1 56.6 24.1a208.21 208.21 0 0 1 112.2 0c30.2-21 48.5-24.1 56.6-24.1a18.64 18.64 0 0 1 5 .5c12.2 31.6 4.5 55 2.2 60.8c14.3 16.1 23 36.6 23 61.6c0 88.2-52.4 107.6-102.3 113.3c8 7.1 15.2 21.1 15.2 42.5c0 30.7-.3 55.5-.3 63c0 5.4 3.1 11.5 11.4 11.5a19.35 19.35 0 0 0 4-.4C415.9 449.2 480 363.1 480 261.7C480 134.9 379.7 32 256 32z"} fill={"currentColor"} />
    </svg>
  );
}

export function NavigateOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M448 64L64 240.14h200a8 8 0 0 1 8 8V448z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function OpenOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M384 224v184a40 40 0 0 1-40 40H104a40 40 0 0 1-40-40V168a40 40 0 0 1 40-40h167.48"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M336 64h112v112"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M224 288L440 72"} />
    </svg>
  );
}

export function OptionsOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M104 160h304M104 352h304"} />
      <circle cx={"160"} cy={"160"} r={"54"} fill={"currentColor"} />
      <circle cx={"352"} cy={"352"} r={"54"} fill={"currentColor"} />
    </svg>
  );
}

export function PencilOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M364.13 125.25L87 403l-23 45l44.99-23l277.76-277.13l-22.62-22.62z"} />
      <path d={"M420.69 68.69l-22.62 22.62l22.62 22.63l22.62-22.63a16 16 0 0 0 0-22.62h0a16 16 0 0 0-22.62 0z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function PeopleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M402 168c-2.93 40.67-33.1 72-66 72s-63.12-31.32-66-72c-3-42.31 26.37-72 66-72s69 30.46 66 72z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M336 304c-65.17 0-127.84 32.37-143.54 95.41c-2.08 8.34 3.15 16.59 11.72 16.59h263.65c8.57 0 13.77-8.25 11.72-16.59C463.85 335.36 401.18 304 336 304z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path d={"M200 185.94c-2.34 32.48-26.72 58.06-53 58.06s-50.7-25.57-53-58.06C91.61 152.15 115.34 128 147 128s55.39 24.77 53 57.94z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M206 306c-18.05-8.27-37.93-11.45-59-11.45c-52 0-102.1 25.85-114.65 76.2c-1.65 6.66 2.53 13.25 9.37 13.25H154"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function PersonAddOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M376 144c-3.92 52.87-44 96-88 96s-84.15-43.12-88-96c-4-55 35-96 88-96s92 42 88 96z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M288 304c-87 0-175.3 48-191.64 138.6c-2 10.92 4.21 21.4 15.65 21.4H464c11.44 0 17.62-10.48 15.65-21.4C463.3 352 375 304 288 304z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M88 176v112"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M144 232H32"} />
    </svg>
  );
}

export function PersonOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M344 144c-3.92 52.87-44 96-88 96s-84.15-43.12-88-96c-4-55 35-96 88-96s92 42 88 96z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M256 304c-87 0-175.3 48-191.64 138.6C62.39 453.52 68.57 464 80 464h352c11.44 0 17.62-10.48 15.65-21.4C431.3 352 343 304 256 304z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
    </svg>
  );
}

export function PinOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <circle cx={256} cy={96} r={64} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M272 164a9 9 0 0 0-9-9h-14a9 9 0 0 0-9 9v293.56a32.09 32.09 0 0 0 2.49 12.38l10.07 24a3.92 3.92 0 0 0 6.88 0l10.07-24a32.09 32.09 0 0 0 2.49-12.38z"} fill={"currentColor"} />
      <circle cx={280} cy={72} r={24} fill={"currentColor"} />
    </svg>
  );
}

export function PlayCircleOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192s192-86 192-192z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path d={"M216.32 334.44l114.45-69.14a10.89 10.89 0 0 0 0-18.6l-114.45-69.14a10.78 10.78 0 0 0-16.32 9.31v138.26a10.78 10.78 0 0 0 16.32 9.31z"} fill={"currentColor"} />
    </svg>
  );
}

export function PricetagOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M435.25 48h-122.9a14.46 14.46 0 0 0-10.2 4.2L56.45 297.9a28.85 28.85 0 0 0 0 40.7l117 117a28.85 28.85 0 0 0 40.7 0L459.75 210a14.46 14.46 0 0 0 4.2-10.2v-123a28.66 28.66 0 0 0-28.7-28.8z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M384 160a32 32 0 1 1 32-32a32 32 0 0 1-32 32z"} fill={"currentColor"} />
    </svg>
  );
}

export function RefreshOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M320 146s24.36-12-64-12a160 160 0 1 0 160 160"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M256 58l80 80l-80 80"} />
    </svg>
  );
}

export function ReturnArrowOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M233 131H404V313H85"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={40} />
      <path d={"M199 199L85 313L199 427"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={40} />
    </svg>
  );
}

export function SaveOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M380.93 57.37A32 32 0 0 0 358.3 48H94.22A46.21 46.21 0 0 0 48 94.22v323.56A46.21 46.21 0 0 0 94.22 464h323.56A46.36 46.36 0 0 0 464 417.78V153.7a32 32 0 0 0-9.37-22.63zM256 416a64 64 0 1 1 64-64a63.92 63.92 0 0 1-64 64zm48-224H112a16 16 0 0 1-16-16v-64a16 16 0 0 1 16-16h192a16 16 0 0 1 16 16v64a16 16 0 0 1-16 16z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function SearchOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M221.09 64a157.09 157.09 0 1 0 157.09 157.09A157.1 157.1 0 0 0 221.09 64z"} fill={"none"} stroke={"currentColor"} strokeMiterlimit={10} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} d={"M338.29 338.29L448 448"} />
    </svg>
  );
}

export function SendOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M470.3 271.15L43.16 447.31a7.83 7.83 0 0 1-11.16-7V327a8 8 0 0 1 6.51-7.86l247.62-47c17.36-3.29 17.36-28.15 0-31.44l-247.63-47a8 8 0 0 1-6.5-7.85V72.59c0-5.74 5.88-10.26 11.16-8L470.3 241.76a16 16 0 0 1 0 29.39z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function SettingsOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M262.29 192.31a64 64 0 1 0 57.4 57.4a64.13 64.13 0 0 0-57.4-57.4zM416.39 256a154.34 154.34 0 0 1-1.53 20.79l45.21 35.46a10.81 10.81 0 0 1 2.45 13.75l-42.77 74a10.81 10.81 0 0 1-13.14 4.59l-44.9-18.08a16.11 16.11 0 0 0-15.17 1.75A164.48 164.48 0 0 1 325 400.8a15.94 15.94 0 0 0-8.82 12.14l-6.73 47.89a11.08 11.08 0 0 1-10.68 9.17h-85.54a11.11 11.11 0 0 1-10.69-8.87l-6.72-47.82a16.07 16.07 0 0 0-9-12.22a155.3 155.3 0 0 1-21.46-12.57a16 16 0 0 0-15.11-1.71l-44.89 18.07a10.81 10.81 0 0 1-13.14-4.58l-42.77-74a10.8 10.8 0 0 1 2.45-13.75l38.21-30a16.05 16.05 0 0 0 6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16 16 0 0 0-6.07-13.94l-38.19-30A10.81 10.81 0 0 1 49.48 186l42.77-74a10.81 10.81 0 0 1 13.14-4.59l44.9 18.08a16.11 16.11 0 0 0 15.17-1.75A164.48 164.48 0 0 1 187 111.2a15.94 15.94 0 0 0 8.82-12.14l6.73-47.89A11.08 11.08 0 0 1 213.23 42h85.54a11.11 11.11 0 0 1 10.69 8.87l6.72 47.82a16.07 16.07 0 0 0 9 12.22a155.3 155.3 0 0 1 21.46 12.57a16 16 0 0 0 15.11 1.71l44.89-18.07a10.81 10.81 0 0 1 13.14 4.58l42.77 74a10.8 10.8 0 0 1-2.45 13.75l-38.21 30a16.05 16.05 0 0 0-6.05 14.08c.33 4.14.55 8.3.55 12.47z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function SparklesOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M259.92 262.91L216.4 149.77a9 9 0 0 0-16.8 0l-43.52 113.14a9 9 0 0 1-5.17 5.17L37.77 311.6a9 9 0 0 0 0 16.8l113.14 43.52a9 9 0 0 1 5.17 5.17l43.52 113.14a9 9 0 0 0 16.8 0l43.52-113.14a9 9 0 0 1 5.17-5.17l113.14-43.52a9 9 0 0 0 0-16.8l-113.14-43.52a9 9 0 0 1-5.17-5.17z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M108 68L88 16L68 68L16 88l52 20l20 52l20-52l52-20l-52-20z"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M426.67 117.33L400 48l-26.67 69.33L304 144l69.33 26.67L400 240l26.67-69.33L496 144l-69.33-26.67z"} />
    </svg>
  );
}

export function Star({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M394 480a16 16 0 0 1-9.39-3L256 383.76L127.39 477a16 16 0 0 1-24.55-18.08L153 310.35L23 221.2a16 16 0 0 1 9-29.2h160.38l48.4-148.95a16 16 0 0 1 30.44 0l48.4 149H480a16 16 0 0 1 9.05 29.2L359 310.35l50.13 148.53A16 16 0 0 1 394 480z"} fill={"currentColor"} />
    </svg>
  );
}

export function StarOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M480 208H308L256 48l-52 160H32l140 96l-54 160l138-100l138 100l-54-160z"} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function StopOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <circle cx={244.5} cy={279} r={148} fill={"none"} stroke={"currentColor"} strokeWidth={40} />
      <rect x={188.5} y={223} width={112} height={112} fill={"currentColor"} />
    </svg>
  );
}

export function SwapHorizontalOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M304 48l112 112l-112 112"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M398.87 160H96"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M208 464L96 352l112-112"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M114 352h302"} />
    </svg>
  );
}

export function SyncOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M434.67 285.59v-29.8c0-98.73-80.24-178.79-179.2-178.79a179 179 0 0 0-140.14 67.36m-38.53 82v29.8C76.8 355 157 435 256 435a180.45 180.45 0 0 0 140-66.92"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M32 256l44-44l46 44"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M480 256l-44 44l-46-44"} />
    </svg>
  );
}

export function TerminalOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <rect x={32} y={48} width={448} height={416} rx={48} ry={48} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M96 112l80 64l-80 64"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M192 240h64"} />
    </svg>
  );
}

export function TextOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M32 415.5l120-320l120 320"} />
      <path fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} d={"M230 303.5H74"} />
      <path d={"M326 239.5c12.19-28.69 41-48 74-48h0c46 0 80 32 80 80v144"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <path d={"M320 358.5c0 36 26.86 58 60 58c54 0 100-27 100-106v-15c-20 0-58 1-92 5c-32.77 3.86-68 19-68 58z"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

export function TrashOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 512 512"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
    >
      <path d={"M112,112l20,320c.95,18.49,14.4,32,32,32H348c17.67,0,30.87-13.51,32-32l20-320"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={80} y1={112} x2={432} y2={112} stroke={"currentColor"} strokeLinecap={"round"} strokeMiterlimit={10} strokeWidth={32} />
      <path d={"M192,112V72h0a23.93,23.93,0,0,1,24-24h80a23.93,23.93,0,0,1,24,24h0v40"} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={256} y1={176} x2={256} y2={400} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={184} y1={176} x2={192} y2={400} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
      <line x1={328} y1={176} x2={320} y2={400} fill={"none"} stroke={"currentColor"} strokeLinecap={"round"} strokeLinejoin={"round"} strokeWidth={32} />
    </svg>
  );
}

/** 思考图标：脑形轮廓（24 栅格线性图标）。 */
export function BrainOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 24 24"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
      fill={"none"}
      stroke={"currentColor"}
      strokeWidth={2}
      strokeLinecap={"round"}
      strokeLinejoin={"round"}
    >
      <path d={"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"} />
      <path d={"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"} />
      <path d={"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"} />
      <path d={"M17.599 6.5a3 3 0 0 0 .399-1.375"} />
      <path d={"M6.003 5.125A3 3 0 0 0 6.401 6.5"} />
      <path d={"M3.477 10.896a4 4 0 0 1 .585-.396"} />
      <path d={"M19.938 10.5a4 4 0 0 1 .585.396"} />
      <path d={"M6 18a4 4 0 0 1-1.967-.516"} />
      <path d={"M19.967 17.484A4 4 0 0 1 18 18"} />
    </svg>
  );
}

/** 运行命令图标：圆角方框内提示符。 */
export function SquareTerminalOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"0 0 24 24"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
      fill={"none"}
      stroke={"currentColor"}
      strokeWidth={2}
      strokeLinecap={"round"}
      strokeLinejoin={"round"}
    >
      <rect x={3} y={3} width={18} height={18} rx={2} />
      <path d={"m7 11 2-2-2-2"} />
      <path d={"M11 13h4"} />
    </svg>
  );
}

/** 编辑文件图标：斜置笔身（笔尖朝左下），与工具卡 edit 行匹配。 */
export function EditPencilOutline({
  size,
  color,
  className,
  style,
}: IoniconProps): ReactNode {
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      viewBox={"-1 -1 26 26"}
      width={size ?? "1em"}
      height={size ?? "1em"}
      className={className}
      style={color ? { color, ...style } : style}
      aria-hidden="true"
      fill={"none"}
      stroke={"currentColor"}
      strokeWidth={1.5}
      strokeLinecap={"round"}
      strokeLinejoin={"round"}
    >
      <path d={"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"} />
      <path d={"m15 5 4 4"} />
    </svg>
  );
}
