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
      <rect x={96} y={96} width={320} height={320} rx={24} ry={24} fill={"none"} stroke={"currentColor"} strokeLinejoin={"round"} strokeWidth={32} />
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

    </svg>
  );
}
