"use client";

import { useEffect } from "react";

const smoothScrollQuery =
  "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)";

export function LandingSmoothScroll() {
  useEffect(() => {
    const mediaQuery = window.matchMedia(smoothScrollQuery);
    let disposed = false;
    let loading = false;
    let lenis: import("lenis").default | undefined;

    async function syncScrollMode() {
      if (!mediaQuery.matches) {
        lenis?.destroy();
        lenis = undefined;
        return;
      }

      if (lenis || loading) return;
      loading = true;

      try {
        const { default: Lenis } = await import("lenis");
        if (disposed || !mediaQuery.matches) return;

        lenis = new Lenis({
          anchors: true,
          autoRaf: true,
          lerp: 0.11,
          smoothWheel: true,
          stopInertiaOnNavigate: true,
          syncTouch: false,
        });
      } catch {
        lenis = undefined;
      } finally {
        loading = false;
      }
    }

    void syncScrollMode();
    mediaQuery.addEventListener("change", syncScrollMode);

    return () => {
      disposed = true;
      mediaQuery.removeEventListener("change", syncScrollMode);
      lenis?.destroy();
    };
  }, []);

  return null;
}
