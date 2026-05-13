import type { StructuredBlock } from "../blocks.ts";
import type { FormatterCtx, LlmCallRow } from "../types.ts";
import { safeWrite } from "../audit.ts";

// ---------------------------------------------------------------------------
// GridShape — expected JSON structure from LLM for structured blocks
// ---------------------------------------------------------------------------

type GridShape = {
  mobility: { walk_distance_m: number };
  pain: { vas: number };
};

/**
 * Hand-rolled shape validator (D-T2: no zod).
 * Asserts that `obj` matches GridShape. Throws a descriptive error naming
 * `blockId` and the offending field path on any mismatch.
 */
function assertGridShape(
  obj: unknown,
  blockId: string,
): asserts obj is GridShape {
  if (typeof obj !== "object" || obj === null) {
    throw new Error(`Block ${blockId}: response is not an object`);
  }
  const o = obj as Record<string, unknown>;

  if (typeof o["mobility"] !== "object" || o["mobility"] === null) {
    throw new Error(
      `Block ${blockId}: missing field 'mobility' (expected object)`,
    );
  }
  const mobility = o["mobility"] as Record<string, unknown>;
  if (typeof mobility["walk_distance_m"] !== "number") {
    throw new Error(
      `Block ${blockId}: missing field 'mobility.walk_distance_m' (expected number)`,
    );
  }

  if (typeof o["pain"] !== "object" || o["pain"] === null) {
    throw new Error(`Block ${blockId}: missing field 'pain' (expected object)`);
  }
  const pain = o["pain"] as Record<string, unknown>;
  if (typeof pain["vas"] !== "number") {
    throw new Error(
      `Block ${blockId}: missing field 'pain.vas' (expected number)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

/**
 * Renders a GridShape as a fixed-width ASCII pipe table.
 * Column widths: Domain=13, Measure=14, Value=6 (one space pad each side inside pipes).
 */
function renderTable(grid: GridShape): string {
  const header = `| Domain        | Measure        | Value  |`;
  const separator = `|---------------|----------------|--------|`;
  const rowMobility = `| Mobility      | Walk distance  | ${grid.mobility.walk_distance_m}m    |`;
  const rowPain = `| Pain          | VAS            | ${grid.pain.vas}/10   |`;
  return [header, separator, rowMobility, rowPain].join("\n");
}

// ---------------------------------------------------------------------------
// structuredFormatter
// ---------------------------------------------------------------------------

/**
 * Structured formatter — replays fixture, validates JSON shape, renders ASCII
 * table, emits audit row.
 */
export async function structuredFormatter(
  block: StructuredBlock,
  ctx: FormatterCtx,
): Promise<string> {
  // 1. Replay fixture
  const fixture = await ctx.replay(block.id, block.prompt);

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(fixture.response);
  } catch {
    throw new Error(`Block ${block.id}: failed to parse JSON response`);
  }

  // 3. Validate shape
  assertGridShape(parsed, block.id);

  // 4. Render table
  const table = renderTable(parsed);

  // 5. Build audit row
  const row: LlmCallRow = {
    schema_version: 1,
    id: ctx.makeId(),
    ts: ctx.now().toISOString(),
    block_id: block.id,
    block_kind: "structured",
    model: fixture.model,
    prompt: block.prompt,
    response: fixture.response,
    tokens_in: fixture.tokensIn,
    tokens_out: fixture.tokensOut,
    latency_ms: 0,
    finish_reason: fixture.finishReason,
  };

  // 6. Emit audit row
  await safeWrite(ctx.audit, row);

  // 7. Return table
  return table;
}
