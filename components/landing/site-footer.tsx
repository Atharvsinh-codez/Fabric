import Image from "next/image";
import Link from "next/link";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Workspace", href: "#workspace" },
      { label: "Collaboration", href: "#collaboration" },
      { label: "AI review", href: "#ai" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Security", href: "/security" },
      { label: "Privacy", href: "/privacy" },
      { label: "Accessibility", href: "/accessibility" },
    ],
  },
  {
    title: "Access",
    links: [
      { label: "Get started", href: "/app" },
      { label: "Create account", href: "/signup" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-[#e6e6e6] bg-white">
      <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-14 sm:px-8 sm:py-18 md:grid-cols-[1.2fr_1.8fr] lg:px-10">
        <div>
          <Link
            href="/"
            aria-label="Fabric home"
            className="inline-flex rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#0084d1]"
          >
            <Image src="/brand/fabric-logo.svg" alt="Fabric" width={116} height={32} className="h-7 w-auto" />
          </Link>
          <p className="mt-5 max-w-[32rem] text-pretty text-base leading-7 text-[#6b7280]">
            A multiplayer canvas for teams who want the evidence, the conversation, and the decision in one place.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-9 sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-semibold text-[#252b31]">{column.title}</h2>
              <ul role="list" className="mt-4 space-y-3">
                {column.links.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="rounded-sm text-base text-[#6b7280] outline-none transition-colors hover:text-[#0084d1] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#0084d1] sm:text-sm"
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

      <div className="border-t border-[#e6e6e6]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-5 text-sm text-[#879192] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p>© 2026 Fabric. All rights reserved.</p>
          <p>Made for thoughtful teams.</p>
        </div>
      </div>
    </footer>
  );
}
