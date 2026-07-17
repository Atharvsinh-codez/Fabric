import type { SVGProps } from "react";

export function FabricMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 30 32" fill="none" aria-hidden="true" {...props}>
      <path d="M10 2h8l-8 20H2L10 2Z" fill="#2563eb" />
      <path d="M20 10h8l-8 20h-8l8-20Z" fill="#2563eb" />
    </svg>
  );
}
