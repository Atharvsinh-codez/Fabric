// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/auth", () => ({
  beginOAuthSignIn: vi.fn(),
}));

import { OAuthProviderButtons } from "@/components/oauth-provider-buttons";

describe("OAuthProviderButtons", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("stages provider entrances without moving the button layout", () => {
    act(() => root.render(<OAuthProviderButtons returnTo="/app" />));

    const forms = [...container.querySelectorAll("form")];
    const buttons = [...container.querySelectorAll("button")];

    expect(forms).toHaveLength(2);
    expect(forms.every((form) => form.className.includes("auth-item-enter"))).toBe(true);
    expect(forms[0]?.className).toContain("[--auth-enter-delay:260ms]");
    expect(forms[1]?.className).toContain("[--auth-enter-delay:320ms]");
    expect(buttons.every((button) => button.className.includes("active:scale-[0.99]"))).toBe(true);
    expect(buttons.every((button) => !button.className.includes("hover:translate"))).toBe(true);
  });

  it("shows stable animated progress and prevents a second provider submission", () => {
    act(() => root.render(<OAuthProviderButtons returnTo="/app" />));

    const googleForm = container.querySelectorAll("form")[0];
    act(() => {
      googleForm?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    });

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons[0]?.getAttribute("aria-busy")).toBe("true");
    expect(buttons[0]?.textContent).toContain("Connecting to Google...");
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(buttons[0]?.querySelector(".animate-spin")).not.toBeNull();
  });
});
