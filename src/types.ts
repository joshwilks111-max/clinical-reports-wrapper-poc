/**
 * Interface contracts shared across lanes.
 *
 * Lane B (src/audit.ts) implements the audit hook factory.
 * Lane C (src/replay.ts) implements the replay loader.
 * Lane A (src/formatters/*.ts) consumes both via FormatterCtx.
 *
 * These contracts are locked in Round 0 so Round 1 lanes parallelize cleanly.
 */

// ---------------------------------------------------------------------------
// Audit row (DD4 — v1 schema)
// ---------------------------------------------------------------------------

export interface LlmCallRow {
  /** Bump on any field-shape change so `bun run check` fails loudly on drift. */
  schema_version: 1;
  /** Monotonic counter, e.g. "call-001". Deterministic under fixed makeId. */
  id: string;
  /** ISO 8601 timestamp from injected clock. */
  ts: string;
  /** Block id from the template (e.g. "functional-status-grid"). */
  block_id: string;
  /** Verbatim blocks make no LLM call, so this is always 'structured' | 'generative'. */
  block_kind: "structured" | "generative";
  /** AI SDK `provider/model` string, e.g. "openai/gpt-4o". */
  model: string;
  /** The prompt sent to the model. */
  prompt: string;
  /** The full response body from the model (or replayed fixture). No PII scrubbing in PoC. */
  response: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  finish_reason: string;
}

export interface AuditWriter {
  write(row: LlmCallRow): Promise<void>;
}

export interface CreateAuditHookOpts {
  writer: AuditWriter;
  /** Injected for replay determinism. Production: `() => new Date()`. */
  now: () => Date;
  /** Injected for replay determinism. Production: `() => randomUUID()`. */
  makeId: () => string;
  model: string;
  blockId: string;
  blockKind: "structured" | "generative";
}

// ---------------------------------------------------------------------------
// Replay loader (Lane C)
// ---------------------------------------------------------------------------

export interface Fixture {
  prompt: string;
  response: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: string;
}

export type ReplayFn = (blockId: string, prompt: string) => Promise<Fixture>;

// ---------------------------------------------------------------------------
// Formatter context (Lane A consumes; demo.ts wires)
// ---------------------------------------------------------------------------

export interface FormatterCtx {
  replay: ReplayFn;
  audit: AuditWriter;
  now: () => Date;
  makeId: () => string;
}
