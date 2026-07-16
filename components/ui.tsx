"use client";

import Image from "next/image";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  getUserInitials,
  type CurrentUser,
} from "@/components/current-user-provider";

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "ghost" | "danger";
  size?: "compact" | "default";
  leading?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, tone = "secondary", size = "compact", leading, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium outline-none transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none disabled:pointer-events-none disabled:scale-100 disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent",
        size === "default" ? "h-9 px-3 text-base sm:text-sm" : "h-8 px-2.5 text-base sm:text-sm",
        Boolean(leading) && (size === "default" ? "gap-2 pl-2.5" : "gap-1.5 pl-2"),
        tone === "primary" &&
          "bg-sky-blue-accent text-white ring-1 ring-sky-blue-accent hover:brightness-95 active:brightness-90",
        tone === "secondary" &&
          "bg-surface-white text-near-black-primary-text ring-1 ring-border-subtle hover:bg-light-surface-tint active:bg-light-surface-tint",
        tone === "ghost" &&
          "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text active:bg-light-surface-tint",
        tone === "danger" &&
          "bg-(--danger-soft) text-(--danger) ring-1 ring-(--danger-border) hover:bg-(--danger-soft-hover)",
        "rounded-radius-md",
        className,
      )}
      {...props}
    >
      {leading}
      {children}
    </button>
  );
});

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  tooltipSide?: "right" | "bottom" | "top";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, tooltipSide = "bottom", className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-tooltip={label}
      data-tooltip-side={tooltipSide}
      className={cx(
        "tooltip-trigger relative grid size-8 shrink-0 place-items-center rounded-radius-md outline-none transition-transform duration-150 ease-out active:scale-95 motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent",
        active
          ? "bg-light-surface-tint text-sky-blue-accent ring-1 ring-border-subtle"
          : "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text active:bg-light-surface-tint",
        className,
      )}
      {...props}
    >
      {children}
      <span
        className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
    </button>
  );
});

export function FabricLogo({ compact = false }: { compact?: boolean }) {
  const src = compact
    ? "/brand/fabric-mark.svg"
    : "/brand/fabric-logo.svg";

  return (
    /* Fabric currently ships a deliberate light interface, so the wordmark must
       not follow the operating system's color preference independently. */
    <Image
      src={src}
      alt="Fabric"
      width={compact ? 32 : 116}
      height={32}
      className={compact ? "size-6 shrink-0" : "h-6 w-auto shrink-0"}
    />
  );
}

type UserAvatarProps = {
  user: Pick<CurrentUser, "name" | "email" | "image">;
  size?: "small" | "medium" | "large";
  className?: string;
};

function trustedAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  if (/^\/api\/users\/[0-9a-f-]{36}\/avatar\?v=[0-9a-f]{64}$/.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function UserAvatar({ user, size = "medium", className }: UserAvatarProps) {
  const image = trustedAvatarUrl(user.image);
  const backgroundStyle = image
    ? ({ backgroundImage: `url(${JSON.stringify(image)})` } satisfies CSSProperties)
    : undefined;

  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center rounded-radius-pill bg-slate-button-dark bg-cover bg-center font-medium text-surface-white outline-1 -outline-offset-1 outline-black/10",
        size === "small" && "size-7 text-[0.6875rem]",
        size === "medium" && "size-9 text-sm",
        size === "large" && "size-16 text-base",
        className,
      )}
      style={backgroundStyle}
    >
      <span className={image ? "sr-only" : undefined}>{getUserInitials(user)}</span>
    </span>
  );
}

const collaborators = [
  { initials: "AM", name: "Ari Morgan", color: "#cc5d3f" },
  { initials: "RK", name: "Rowan Kim", color: "#2e7c67" },
  { initials: "SL", name: "Sam Lee", color: "#8b5fbf" },
];

export function AvatarStack() {
  return (
    <div className="flex items-center -space-x-1.5" aria-label="3 collaborators present">
      {collaborators.map((person) => (
        <div
          key={person.initials}
          title={person.name}
          className="grid size-7 shrink-0 place-items-center rounded-full text-[0.6875rem] font-medium text-white ring-2 ring-surface-white outline-1 -outline-offset-1 outline-black/10"
          style={{ backgroundColor: person.color }}
        >
          {person.initials}
        </div>
      ))}
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-light-surface-tint text-[0.6875rem] font-medium text-muted-gray ring-2 ring-surface-white">
        +2
      </div>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <span className={cx("h-4 w-px shrink-0 bg-near-black-primary-text/10", className)} aria-hidden="true" />;
}
