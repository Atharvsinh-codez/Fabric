// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BoardSummary } from "@/lib/boards/client";
import { BoardPreview } from "./board-preview";

const board = {
  id: "0bcb645c-3e28-459e-8369-a03582185d87",
  workspaceId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
  projectId: "35c44525-e990-4d4c-87b8-c76e85ea8ad5",
  projectName: "Unfiled",
  ownerId: "fba5643f-b5a4-492e-b5d2-bc21ce558085",
  title: "Product planning board",
  cover: null,
  status: "active",
  sharingPolicy: "workspace",
  revision: 52,
  documentGenerationId: "740afc4d-43d8-4876-bc21-5189ad4c28ef",
  role: "owner",
  favorite: false,
  pinned: false,
  lastOpenedAt: null,
  archivedAt: null,
  createdAt: "2026-07-17T10:00:00.000Z",
  updatedAt: "2026-07-17T11:50:00.000Z",
} satisfies BoardSummary;

describe("BoardPreview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("uses generation and revision only as an invisible preview version", () => {
    act(() => root.render(<BoardPreview board={board} />));
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(
      `/api/boards/${board.id}/thumbnail?v=${board.documentGenerationId}.${board.revision}`,
    );
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("alt")).toBe("");
    expect(container.textContent).not.toContain("Revision");
    expect(container.textContent).not.toContain("52");
  });

  it("falls back to the neutral board grid when the private image fails", () => {
    act(() => root.render(<BoardPreview board={board} />));
    const image = container.querySelector("img")!;
    act(() => image.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild?.className).toContain("background-image");
  });
});
