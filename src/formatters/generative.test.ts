import { describe, expect, test } from "bun:test";
import type { GenerativeBlock } from "../blocks.ts";
import type { FormatterCtx, LlmCallRow } from "../types.ts";
import { generativeFormatter } from "./generative.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCtx(responseOverride?: string): {
  ctx: FormatterCtx;
  rows: LlmCallRow[];
} {
  const rows: LlmCallRow[] = [];
  const ctx: FormatterCtx = {
    replay: async () => ({
      prompt: "p",
      response: responseOverride ?? "short response",
      model: "openai/gpt-4o",
      tokensIn: 50,
      tokensOut: 20,
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
  return { ctx, rows };
}

function makeBlock(id = "clinical-impression"): GenerativeBlock {
  return { kind: "generative", id, prompt: "Write a clinical impression." };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generativeFormatter", () => {
  // 1. Short response (under 80 chars) → returned unchanged after trim.
  test("short response is returned unchanged (after trim)", async () => {
    const { ctx } = makeCtx("  short response  ");
    const block = makeBlock();
    const result = await generativeFormatter(block, ctx);
    expect(result).toBe("short response");
  });

  // 2. Long response (>80 chars on one line) → word-wrapped at column 80
  //    with no broken words.
  test("long line is word-wrapped at 80 cols without breaking words", async () => {
    // Craft a line that is >80 chars and has spaces to wrap at.
    const longLine =
      "The patient demonstrates significant limitations in functional mobility " +
      "including reduced endurance during sustained walking tasks.";
    const { ctx } = makeCtx(longLine);
    const block = makeBlock();
    const result = await generativeFormatter(block, ctx);

    const lines = result.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
    // Re-joining with spaces should recover all words.
    const allWords = longLine.split(" ");
    const resultWords = result.split(/\s+/);
    expect(resultWords).toEqual(allWords);
  });

  // 3. Multi-paragraph response → paragraph breaks preserved.
  test("multi-paragraph response preserves paragraph breaks", async () => {
    const multiPara =
      "First paragraph, a short one.\nSecond paragraph, also short.\nThird paragraph here.";
    const { ctx } = makeCtx(multiPara);
    const block = makeBlock();
    const result = await generativeFormatter(block, ctx);

    const lines = result.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe("First paragraph, a short one.");
    expect(lines[1]).toBe("Second paragraph, also short.");
    expect(lines[2]).toBe("Third paragraph here.");
  });

  // 4. Empty response → returns empty string, audit row still emits.
  //    DD2 hard rule: emit row regardless.
  test("empty response returns empty string and audit row still emits", async () => {
    const { ctx, rows } = makeCtx("");
    const block = makeBlock();
    const result = await generativeFormatter(block, ctx);

    expect(result).toBe("");
    expect(rows.length).toBe(1);
    expect(rows[0]!.response).toBe("");
  });

  // 5. Exactly ONE audit row emitted per call.
  test("exactly one audit row emitted per call", async () => {
    const { ctx, rows } = makeCtx("A normal response.");
    const block = makeBlock();
    await generativeFormatter(block, ctx);
    expect(rows.length).toBe(1);
  });

  // 6. Emitted row has all 12 fields populated correctly.
  test("emitted row has all 12 fields correctly populated with block_kind=generative", async () => {
    const response = "The patient reports pain at rest.";
    const { ctx, rows } = makeCtx(response);
    const block: GenerativeBlock = {
      kind: "generative",
      id: "clinical-impression",
      prompt: "Write a clinical impression.",
    };
    await generativeFormatter(block, ctx);

    expect(rows.length).toBe(1);
    const row = rows[0]!;

    expect(row.schema_version).toBe(1);
    expect(row.id).toBe("call-001");
    expect(row.ts).toBe("2026-01-01T00:00:00.000Z");
    expect(row.block_id).toBe("clinical-impression");
    expect(row.block_kind).toBe("generative");
    expect(row.model).toBe("openai/gpt-4o");
    expect(row.prompt).toBe("Write a clinical impression.");
    expect(row.response).toBe(response);
    expect(row.tokens_in).toBe(50);
    expect(row.tokens_out).toBe(20);
    expect(row.latency_ms).toBe(0);
    expect(row.finish_reason).toBe("stop");
  });

  // 7. Degenerate wrapAt80 case: a single long word exceeding 80 chars
  //    must be kept as-is on its own line (don't crash).
  test("single word longer than 80 chars is kept as-is (no crash)", async () => {
    const singleLongWord = "a".repeat(100); // 100 'a' chars, no spaces
    const { ctx } = makeCtx(singleLongWord);
    const block = makeBlock();
    const result = await generativeFormatter(block, ctx);

    // The word should appear on a single line unchanged.
    expect(result).toBe(singleLongWord);
    const lines = result.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe(singleLongWord);
  });
});
