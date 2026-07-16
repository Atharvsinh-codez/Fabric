import { describe, expect, it } from "vitest";

import { BOARD_CHECKPOINT_NAME_MAX_LENGTH } from "../../db/schema/checkpoints";
import { CreateBoardCheckpointSchema, RestoreBoardCheckpointSchema } from "./contracts";

describe("board checkpoint contracts", () => {
  it("normalizes a bounded human-readable name", () => {
    expect(CreateBoardCheckpointSchema.parse({ name: "  Before synthesis  " })).toEqual({
      name: "Before synthesis",
    });
    expect(
      CreateBoardCheckpointSchema.safeParse({
        name: "x".repeat(BOARD_CHECKPOINT_NAME_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it("rejects empty, overlong, and client-supplied snapshot fields", () => {
    expect(CreateBoardCheckpointSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(
      CreateBoardCheckpointSchema.safeParse({
        name: "x".repeat(BOARD_CHECKPOINT_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      CreateBoardCheckpointSchema.safeParse({
        name: "Injected snapshot",
        document: { secret: true },
      }).success,
    ).toBe(false);
  });

  it("keeps restore commands free of client-controlled document data", () => {
    expect(RestoreBoardCheckpointSchema.safeParse({}).success).toBe(true);
    expect(
      RestoreBoardCheckpointSchema.safeParse({ document: { version: 1 } }).success,
    ).toBe(false);
  });
});
