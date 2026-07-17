import type { Metadata, Viewport } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/eb-garamond";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/host-grotesk";
import "lenis/dist/lenis.css";
import "./globals.css";

import { SiteStructuredData } from "@/components/site-structured-data";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  applicationName: SITE_NAME,
  title: {
    default: "Fabric — Multiplayer Design Canvas",
    template: "%s — Fabric",
  },
  description: SITE_DESCRIPTION,
  category: "productivity",
  keywords: [
    "collaborative whiteboard",
    "multiplayer canvas",
    "open-source whiteboard",
    "visual collaboration",
    "student whiteboard",
    "local-first software",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  manifest: "/manifest.webmanifest",
  formatDetection: {
    address: false,
    email: false,
    telephone: false,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
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
      <body>
        <SiteStructuredData />
        {children}
      </body>
    </html>
  );
}
