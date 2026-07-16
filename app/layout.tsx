import type { Metadata, Viewport } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/eb-garamond";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/host-grotesk";
import "lenis/dist/lenis.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fabric — Multiplayer Design Canvas",
    template: "%s — Fabric",
  },
  description:
    "A local-first multiplayer design canvas for turning evidence into shared decisions.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef3f8" },
    { media: "(prefers-color-scheme: dark)", color: "#eef3f8" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="antialiased">
      <body>{children}</body>
    </html>
  );
}
