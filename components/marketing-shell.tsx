import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const editorHref = "/app";

const primaryNavigation = [
  { href: "/features", label: "Features" },
  { href: "/ai-and-offline", label: "AI & Offline" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
];

const footerNavigation = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/ai-and-offline", label: "AI & Offline" },
      { href: editorHref, label: "Get started" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/security", label: "Security" },
      { href: "/privacy", label: "Privacy" },
      { href: "/accessibility", label: "Accessibility" },
    ],
  },
  {
    title: "Get Started",
    links: [
      { href: "/pricing", label: "Current Access" },
      { href: "/signup", label: "Create Workspace" },
      { href: "/login", label: "Sign In" },
    ],
  },
];

const navLinkClass =
  "rounded-radius-pill px-3 py-2 font-medium text-muted-gray outline-none hover:-translate-y-px hover:bg-light-surface-tint hover:text-near-black-primary-text active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent transition-transform";

function MarketingLogo() {
  return <Image src="/brand/fabric-logo.svg" alt="Fabric" width={116} height={32} className="h-6 w-auto" />;
}

export function MarketingHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 py-3 sm:px-5">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center rounded-radius-pill bg-surface-white/82 px-3 shadow-[0_1px_2px_rgb(18_18_18/0.04),0_12px_32px_rgb(18_18_18/0.08),inset_0_1px_0_rgb(255_255_255/0.88)] ring-1 ring-white/80 backdrop-blur-xl sm:px-4">
        <div className="flex flex-1 items-center">
          <Link
            href="/"
            aria-label="Homepage"
            className="rounded-radius-md p-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
          >
            <MarketingLogo />
          </Link>
        </div>

        <nav aria-label="Primary navigation" className="flex items-center gap-1 max-lg:hidden">
          {primaryNavigation.map((item) => (
            <Link key={item.href} href={item.href} className={navLinkClass}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <Link
            href={editorHref}
            className="relative inline-flex h-9 shrink-0 items-center justify-center rounded-radius-pill bg-surface-white px-3 font-medium text-slate-button-dark outline-none ring-1 ring-near-black-primary-text/12 hover:-translate-y-px hover:bg-light-surface-tint active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent transition-transform max-sm:hidden"
          >
            Get started
          </Link>

          <details className="group relative lg:hidden">
            <summary className="relative grid size-12 cursor-pointer list-none place-items-center rounded-radius-pill text-near-black-primary-text outline-none hover:bg-light-surface-tint active:bg-border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent [&::-webkit-details-marker]:hidden">
              <span className="sr-only">Toggle navigation</span>
              <Bars3Icon className="size-6 shrink-0 stroke-current group-open:hidden" aria-hidden="true" />
              <XMarkIcon className="size-6 shrink-0 stroke-current group-not-open:hidden" aria-hidden="true" />
            </summary>
            <div className="absolute top-14 right-0 flex w-[min(88vw,22rem)] flex-col gap-1 rounded-radius-2xl bg-surface-white p-2 shadow-[0_20px_50px_rgb(18_18_18/0.14)] ring-1 ring-near-black-primary-text/8">
              <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
                {primaryNavigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-radius-xl px-4 py-3 font-medium text-muted-gray outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text active:bg-border-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-blue-accent"
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href={editorHref}
                  className="rounded-radius-xl bg-sky-blue-accent px-4 py-3 font-medium text-white outline-none hover:-translate-y-px hover:bg-sky-blue-accent/90 active:translate-y-0 active:bg-sky-blue-accent/80 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-near-black-primary-text transition-transform"
                >
                  Get started
                </Link>
              </nav>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-near-black-primary-text/8 bg-surface-white">
      <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-14 sm:px-8 sm:py-16 md:grid-cols-[2fr_3fr] lg:px-10">
        <div className="flex flex-col items-start gap-5">
          <Link
            href="/"
            aria-label="Homepage"
            className="rounded-radius-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
          >
            <MarketingLogo />
          </Link>
          <p className="max-w-[36ch] text-pretty text-base text-muted-gray sm:text-sm">
            A multiplayer design canvas for turning scattered research into shared direction, even when the network disappears.
          </p>
          <p className="font-mono text-sm text-muted-gray">Multiplayer canvas · Built with Next.js</p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {footerNavigation.map((group) => (
            <div key={group.title} className="flex flex-col gap-3">
              <p className="font-medium text-near-black-primary-text">{group.title}</p>
              <ul role="list" className="flex flex-col gap-2.5">
                {group.links.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="rounded-radius-sm font-normal text-muted-gray outline-none hover:text-sky-blue-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-near-black-primary-text/8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-5 text-base text-muted-gray sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:text-sm lg:px-10">
          <p>© 2026 Fabric. All rights reserved.</p>
          <p>Built around local agency, explicit approval, and honest limits.</p>
        </div>
      </div>
    </footer>
  );
}

export function MarketingShell({ children, overlayHeader = false }: { children: ReactNode; overlayHeader?: boolean }) {
  return (
    <div className="isolate min-h-dvh bg-light-surface-tint font-sans text-near-black-primary-text antialiased">
      <MarketingHeader />
      <div className={overlayHeader ? undefined : "pt-20"}>{children}</div>
      <MarketingFooter />
    </div>
  );
}
