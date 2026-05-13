/**
 * Audit hook — single emission point (CLAUDE.md hard rule #2).
 *
 * Every LLM call routed through the wrapper emits exactly one LlmCallRow via
 * createAuditHook().onFinish. No other code path should write a row.
 *
 * Lane B implementation per Task 3 of the block-routing PoC plan.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditWriter, CreateAuditHookOpts, LlmCallRow } from "./types.ts";

// ---------------------------------------------------------------------------
// InMemoryAuditWriter
// ---------------------------------------------------------------------------

/**
 * In-memory writer for tests.
 * Inspect `.rows` after the call under test to assert shape and count.
 */
export class InMemoryAuditWriter implements AuditWriter {
  readonly rows: LlmCallRow[];

  constructor() {
    this.rows = [];
  }

  write(row: LlmCallRow): Promise<void> {
    this.rows.push(row);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// FileAuditWriter
// ---------------------------------------------------------------------------

/**
 * Writes each row as pretty-printed JSON to `${auditDir}/${row.id}.json`.
 * Creates the directory lazily on first write (recursive mkdirSync).
 * Insertion order of LlmCallRow fields is preserved (DD6).
 */
export class FileAuditWriter implements AuditWriter {
  constructor(private readonly auditDir: string) {}

  write(row: LlmCallRow): Promise<void> {
    mkdirSync(this.auditDir, { recursive: true });
    const filePath = join(this.auditDir, `${row.id}.json`);
    writeFileSync(filePath, JSON.stringify(row, null, 2));
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// safeWrite
// ---------------------------------------------------------------------------

/**
 * Calls `writer.write(row)` and catches any thrown error.
 * Logs the DD2-locked warning message to stderr. Does NOT re-throw.
 *
 * Audit failure must NOT break the user-facing call (CLAUDE.md hard rule #3).
 */
export function safeWrite(writer: AuditWriter, row: LlmCallRow): Promise<void> {
  return writer.write(row).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit:warn] failed to persist row for block '${row.block_id}': ${message}. Demo continues; audit row dropped.`,
    );
  });
}

// ---------------------------------------------------------------------------
// createAuditHook
// ---------------------------------------------------------------------------

/**
 * Returns an object with an `onFinish` handler shaped like AI SDK v1.5
 * `experimental_telemetry`. This is the single emission point for LlmCallRow.
 *
 * In v1 (canned/replay mode) formatters call onFinish directly after replay.
 * In v1.5 (live mode) AI SDK will call it automatically.
 */
export function createAuditHook(opts: CreateAuditHookOpts): {
  onFinish: (result: {
    text?: string;
    usage?: { promptTokens?: number; completionTokens?: number };
    finishReason?: string;
  }) => Promise<void>;
} {
  return {
    async onFinish(result): Promise<void> {
      // Defensive: providers may omit usage on stream errors or content-filter
      // responses. Missing fields default to 0 rather than crash.
      const usage = result.usage ?? { promptTokens: 0, completionTokens: 0 };

      const row: LlmCallRow = {
        schema_version: 1,
        id: opts.makeId(),
        ts: opts.now().toISOString(),
        block_id: opts.blockId,
        block_kind: opts.blockKind,
        model: opts.model,
        prompt: "",
        response: result.text ?? "",
        tokens_in: usage.promptTokens ?? 0,
        tokens_out: usage.completionTokens ?? 0,
        // TODO(v1.5): wire latency_ms — live-mode wall-clock measurement deferred
        latency_ms: 0,
        finish_reason: result.finishReason ?? "stop",
      };

      await safeWrite(opts.writer, row);
    },
  };
}
