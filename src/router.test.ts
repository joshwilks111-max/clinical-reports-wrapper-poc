import { describe, expect, test } from "bun:test";
import type { TemplateBlock } from "./blocks.ts";
import type { FormatterCtx, LlmCallRow } from "./types.ts";
import { route } from "./router.ts";

// ---------------------------------------------------------------------------
// Shared ctx factory
// ---------------------------------------------------------------------------

const VALID_GRID_RESPONSE = JSON.stringify({
  mobility: { walk_distance_m: 50 },
  pain: { vas: 7 },
});

function makeCtx(opts?: {
  replayCalls?: Array<{ id: string; prompt: string }>;
  auditRows?: LlmCallRow[];
  throwForId?: string;
}): FormatterCtx {
  const replayCalls = opts?.replayCalls ?? [];
  const auditRows = opts?.auditRows ?? [];
  const throwForId = opts?.throwForId;

  return {
    replay: async (id, prompt) => {
      replayCalls.push({ id, prompt });
      if (throwForId !== undefined && id === throwForId) {
        throw new Error(`replay failed for block: ${id}`);
      }
      if (id === "grid") {
        return {
          prompt,
          response: VALID_GRID_RESPONSE,
          model: "m",
          tokensIn: 1,
          tokensOut: 1,
          finishReason: "stop",
        };
      }
      return {
        prompt,
        response: "free text",
        model: "m",
        tokensIn: 1,
        tokensOut: 1,
        finishReason: "stop",
      };
    },
    audit: {
      write: async (row) => {
        auditRows.push(row);
      },
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    makeId: () => "call-001",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("route", () => {
  // 1. Mixed blocks — formatters called in declared order with correct args
  test("mixed blocks return correct output in declared order", async () => {
    const replayCalls: Array<{ id: string; prompt: string }> = [];
    const auditRows: LlmCallRow[] = [];
    const ctx = makeCtx({ replayCalls, auditRows });

    const blocks: TemplateBlock[] = [
      { kind: "verbatim", id: "intro", text: "FIXED" },
      { kind: "structured", id: "grid", prompt: "p1" },
      { kind: "generative", id: "imp", prompt: "p2" },
    ];

    const out = await route(blocks, ctx);

    expect(out).toHaveLength(3);
    expect(out[0]).toBe("FIXED");
    expect(out[1]).toContain("Walk distance");
    expect(out[2]).toContain("free text");
    // verbatim makes no replay call
    expect(replayCalls).toHaveLength(2);
    // verbatim emits no audit row
    expect(auditRows).toHaveLength(2);
    expect(auditRows[0]?.block_kind).toBe("structured");
    expect(auditRows[1]?.block_kind).toBe("generative");
  });

  // 2. Empty array → returns [], no calls
  test("empty block array returns empty output with no replay or audit calls", async () => {
    const replayCalls: Array<{ id: string; prompt: string }> = [];
    const auditRows: LlmCallRow[] = [];
    const ctx = makeCtx({ replayCalls, auditRows });

    const out = await route([], ctx);

    expect(out).toHaveLength(0);
    expect(replayCalls).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  // 3. Formatter throws → propagates
  test("formatter throw propagates out of route", async () => {
    const ctx = makeCtx({ throwForId: "grid" });

    const blocks: TemplateBlock[] = [
      { kind: "structured", id: "grid", prompt: "p1" },
    ];

    await expect(route(blocks, ctx)).rejects.toThrow(
      "replay failed for block: grid",
    );
  });

  // 4. T1 cast-cheat regression — assertNever fires at runtime for unknown kind
  test("T1 cast-cheat regression: unknown kind throws 'unhandled block kind'", async () => {
    const ctx = makeCtx();

    const out = route([{ kind: "unknown" as any, id: "x" } as any], ctx);
    await expect(out).rejects.toThrow(/unhandled block kind/);
  });

  // 5. Order preservation under async — structured/generative/structured/verbatim/generative
  test("output order matches input order for mixed async/sync blocks", async () => {
    const replayCalls: Array<{ id: string; prompt: string }> = [];
    const auditRows: LlmCallRow[] = [];
    const ctx = makeCtx({ replayCalls, auditRows });

    const blocks: TemplateBlock[] = [
      { kind: "structured", id: "grid", prompt: "pa" },
      { kind: "generative", id: "gen1", prompt: "pb" },
      { kind: "structured", id: "grid", prompt: "pc" },
      { kind: "verbatim", id: "sep", text: "---" },
      { kind: "generative", id: "gen2", prompt: "pd" },
    ];

    const out = await route(blocks, ctx);

    expect(out).toHaveLength(5);
    // structured → contains "Walk distance"
    expect(out[0]).toContain("Walk distance");
    // generative → contains "free text"
    expect(out[1]).toContain("free text");
    // structured again
    expect(out[2]).toContain("Walk distance");
    // verbatim → literal "---"
    expect(out[3]).toBe("---");
    // generative again
    expect(out[4]).toContain("free text");

    // 4 LLM calls (structured+generative+structured+generative), no verbatim call
    expect(replayCalls).toHaveLength(4);
    expect(auditRows).toHaveLength(4);
  });
});
