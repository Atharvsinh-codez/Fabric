import { ImageResponse } from "next/og";

import { SocialCard } from "@/components/brand/social-card";

export const alt = "Fabric — open-source multiplayer canvas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<SocialCard />, size);
}
