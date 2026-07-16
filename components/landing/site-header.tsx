"use client";

import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const navigation = [
  { href: "#why-fabric", label: "Why Fabric" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#ai", label: "AI review" },
  { href: "/pricing", label: "Pricing" },
];

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const threshold = document.getElementById("landing-header-threshold");
    if (!threshold) return;

    const observer = new IntersectionObserver(([entry]) => {
      setScrolled(!entry?.isIntersecting);
    });

    observer.observe(threshold);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function closeMobileMenu(event: KeyboardEvent | PointerEvent) {
      const menu = mobileMenuRef.current;
      if (!menu?.open) return;

      const shouldRestoreFocus = event instanceof KeyboardEvent;

      if (shouldRestoreFocus) {
        if (event.key !== "Escape") return;
      } else if (event.target instanceof Node && menu.contains(event.target)) {
        return;
      }

      menu.removeAttribute("open");
      if (shouldRestoreFocus) menu.querySelector("summary")?.focus();
    }

    document.addEventListener("keydown", closeMobileMenu);
    document.addEventListener("pointerdown", closeMobileMenu);
    return () => {
      document.removeEventListener("keydown", closeMobileMenu);
      document.removeEventListener("pointerdown", closeMobileMenu);
    };
  }, []);

  function closeMobileMenu() {
    mobileMenuRef.current?.removeAttribute("open");
  }

  return (
    <header
      data-scrolled={scrolled || undefined}
      className="fixed inset-x-0 top-0 z-40 border-b border-transparent px-4 py-4 transition-[background-color,border-color,box-shadow] duration-300 data-scrolled:border-[#252b31]/7 data-scrolled:bg-white data-scrolled:shadow-[0_8px_30px_rgb(37_43_49/0.05)] sm:px-7 sm:py-5"
    >
      <div className="mx-auto flex h-12 w-full max-w-[90rem] items-center justify-between sm:h-14">
        <Link
          href="/"
          aria-label="Fabric home"
          className="rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-blue-accent"
        >
          <Image
            src="/brand/fabric-logo.svg"
            alt="Fabric"
            width={116}
            height={32}
            priority
            className="h-7 w-auto"
          />
        </Link>

        <nav
          aria-label="Landing page navigation"
          className="hidden items-center gap-1 lg:flex"
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-4 py-2 text-sm font-medium text-[#35414b] outline-none transition-colors hover:bg-white/48 hover:text-[#17202a] focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/app"
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#252b31] px-5 text-sm font-semibold text-white outline-none transition-transform hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-sky-blue-accent"
          >
            Get started
          </Link>

          <details ref={mobileMenuRef} className="group relative lg:hidden">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full bg-white/68 text-[#252b31] ring-1 ring-white/75 backdrop-blur-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent [&::-webkit-details-marker]:hidden">
              <span className="sr-only">Toggle navigation</span>
              <Bars3Icon className="size-5 group-open:hidden" aria-hidden="true" />
              <XMarkIcon className="hidden size-5 group-open:block" aria-hidden="true" />
            </summary>
            <nav
              aria-label="Mobile landing page navigation"
              className="absolute top-12 right-0 flex w-[min(19rem,calc(100vw-2rem))] flex-col gap-1 rounded-2xl bg-white p-2 shadow-[0_20px_50px_rgb(37_43_49/0.16)] ring-1 ring-[#252b31]/8"
            >
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMobileMenu}
                  className="rounded-xl px-4 py-3 text-base font-medium text-[#59636d] outline-none hover:bg-[#f5f7f8] hover:text-[#252b31] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-blue-accent"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
