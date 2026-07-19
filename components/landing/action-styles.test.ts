import { describe, expect, it } from "vitest";

import {
  landingActionIconStyles,
  landingActionStyles,
} from "@/components/landing/action-styles";

describe("landing action styles", () => {
  it("keeps every action and icon anchored on hover", () => {
    const interactiveStyles = [
      ...Object.values(landingActionStyles),
      ...Object.values(landingActionIconStyles),
    ];

    for (const className of interactiveStyles) {
      expect(className).not.toMatch(/(?:hover|group-hover):[^\s]*translate/);
    }
  });

  it("uses stable focus, reduced-motion, and pressed feedback", () => {
    for (const className of Object.values(landingActionStyles)) {
      expect(className).toContain("focus-visible:outline-2");
      expect(className).toContain("motion-safe:active:scale-[0.98]");
      expect(className).toContain("motion-reduce:transition-none");
    }
  });
});
