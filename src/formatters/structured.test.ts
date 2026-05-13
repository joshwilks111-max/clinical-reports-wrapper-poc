import { describe, expect, test } from "bun:test";
import type { StructuredBlock } from "../blocks.ts";
import type { FormatterCtx, LlmCallRow } from "../types.ts";
import { structuredFormatter } from "./structured.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const VALID_RESPONSE = JSON.stringify({
  mobility: { walk_distance_m: 50 },
  pain: { vas: 7 },
});

function makeCtx(
  responseOverride: string = VALID_RESPONSE,
  rows: LlmCallRow[] = [],
): FormatterCtx {
  return {
    replay: async () => ({
      prompt: "p",
      response: responseOverride,
      model: "openai/gpt-4o",
      tokensIn: 142,
      tokensOut: 88,
      finishReason: "stop",
    }),
    audit: {
      write: async (row) => {
        rows.push(row);
      },
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    makeId: () => "call-001",
  };
}

const BLOCK: StructuredBlock = {
  kind: "structured",
  id: "functional-status-grid",
  prompt: "Return JSON for mobility and pain.",
};

const EXPECTED_TABLE = [
  "| Domain        | Measure        | Value  |",
  "|---------------|----------------|--------|",
  "| Mobility      | Walk distance  | 50m    |",
  "| Pain          | VAS            | 7/10   |",
].join("\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("structuredFormatter", () => {
  test("valid stub JSON returns expected ASCII table (exact byte match)", async () => {
    const result = await structuredFormatter(BLOCK, makeCtx());
    expect(result).toBe(EXPECTED_TABLE);
  });

  test("malformed JSON throws clear error containing block.id", async () => {
    const ctx = makeCtx("not-valid-json{{");
    await expect(structuredFormatter(BLOCK, ctx)).rejects.toThrow(
      "Block functional-status-grid: failed to parse JSON response",
    );
  });

  test("missing 'pain' field throws naming 'pain'", async () => {
    const ctx = makeCtx(JSON.stringify({ mobility: { walk_distance_m: 50 } }));
    await expect(structuredFormatter(BLOCK, ctx)).rejects.toThrow("pain");
  });

  test("missing 'mobility.walk_distance_m' throws naming the path", async () => {
    const ctx = makeCtx(JSON.stringify({ mobility: {}, pain: { vas: 7 } }));
    await expect(structuredFormatter(BLOCK, ctx)).rejects.toThrow(
      "mobility.walk_distance_m",
    );
  });

  test("wrong type on 'pain.vas' (string) throws naming field and expected type", async () => {
    const ctx = makeCtx(
      JSON.stringify({
        mobility: { walk_distance_m: 50 },
        pain: { vas: "seven" },
      }),
    );
    await expect(structuredFormatter(BLOCK, ctx)).rejects.toThrow(
      /pain\.vas.*number|number.*pain\.vas/,
    );
  });

  test("exactly ONE audit row emitted per call", async () => {
    const rows: LlmCallRow[] = [];
    const ctx = makeCtx(VALID_RESPONSE, rows);
    await structuredFormatter(BLOCK, ctx);
    expect(rows.length).toBe(1);
  });

  test("emitted row has all 12 fields populated correctly", async () => {
    const rows: LlmCallRow[] = [];
    const ctx = makeCtx(VALID_RESPONSE, rows);
    await structuredFormatter(BLOCK, ctx);

    const row = rows[0]!;
    expect(row.schema_version).toBe(1);
    expect(row.id).toBe("call-001");
    expect(row.ts).toBe("2026-01-01T00:00:00.000Z");
    expect(row.block_id).toBe("functional-status-grid");
    expect(row.block_kind).toBe("structured");
    expect(row.model).toBe("openai/gpt-4o");
    expect(row.prompt).toBe("Return JSON for mobility and pain.");
    expect(row.response).toBe(VALID_RESPONSE);
    expect(row.tokens_in).toBe(142);
    expect(row.tokens_out).toBe(88);
    expect(row.latency_ms).toBe(0);
    expect(row.finish_reason).toBe("stop");
  });
});
