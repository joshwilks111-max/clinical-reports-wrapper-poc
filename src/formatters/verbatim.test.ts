import { describe, expect, test } from "bun:test";
import type { VerbatimBlock } from "../blocks.ts";
import { verbatimFormatter } from "./verbatim.ts";

describe("verbatimFormatter", () => {
  test("returns block.text unchanged", () => {
    const block: VerbatimBlock = {
      kind: "verbatim",
      id: "block-001",
      text: "Hello, world!",
    };
    expect(verbatimFormatter(block)).toBe("Hello, world!");
  });

  test("returns empty string when block.text is empty", () => {
    const block: VerbatimBlock = {
      kind: "verbatim",
      id: "block-002",
      text: "",
    };
    expect(verbatimFormatter(block)).toBe("");
  });

  test("does not call replay or audit.write even if ctx is passed via any", () => {
    const block: VerbatimBlock = {
      kind: "verbatim",
      id: "block-003",
      text: "sentinel text",
    };

    const replayCalls: string[] = [];
    const auditCalls: unknown[] = [];
    const sentinelCtx = {
      replay: (id: string) => {
        replayCalls.push(id);
        return Promise.reject(new Error("verbatim called replay"));
      },
      audit: {
        write: (row: unknown) => {
          auditCalls.push(row);
          return Promise.reject(new Error("verbatim called audit"));
        },
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      makeId: () => "call-001",
    };

    // Cast to any so TS allows the extra arg — that's the point of this test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (verbatimFormatter as any)(block, sentinelCtx);
    expect(replayCalls).toEqual([]);
    expect(auditCalls).toEqual([]);
  });
});
