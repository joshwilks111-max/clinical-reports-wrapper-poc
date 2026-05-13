import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InMemoryAuditWriter,
  FileAuditWriter,
  safeWrite,
  createAuditHook,
} from "./audit.ts";
import type { LlmCallRow, CreateAuditHookOpts } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<LlmCallRow> = {}): LlmCallRow {
  return {
    schema_version: 1,
    id: "call-001",
    ts: "2026-01-01T00:00:00.000Z",
    block_id: "functional-status-grid",
    block_kind: "structured",
    model: "openai/gpt-4o",
    prompt: "",
    response: "some response",
    tokens_in: 142,
    tokens_out: 88,
    latency_ms: 0,
    finish_reason: "stop",
    ...overrides,
  };
}

function makeOpts(
  overrides: Partial<CreateAuditHookOpts> = {},
): CreateAuditHookOpts {
  const writer = new InMemoryAuditWriter();
  return {
    writer,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    makeId: () => "call-001",
    model: "openai/gpt-4o",
    blockId: "functional-status-grid",
    blockKind: "structured",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InMemoryAuditWriter
// ---------------------------------------------------------------------------

describe("InMemoryAuditWriter", () => {
  it("write pushes the row to .rows", async () => {
    const writer = new InMemoryAuditWriter();
    const row = makeRow();
    await writer.write(row);
    expect(writer.rows).toHaveLength(1);
    expect(writer.rows[0]).toEqual(row);
  });
});

// ---------------------------------------------------------------------------
// FileAuditWriter
// ---------------------------------------------------------------------------

describe("FileAuditWriter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `audit-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the dir if missing and writes pretty-printed JSON named <row.id>.json", async () => {
    const writer = new FileAuditWriter(tmpDir);
    const row = makeRow({ id: "call-001" });

    await writer.write(row);

    const filePath = join(tmpDir, "call-001.json");
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as LlmCallRow;

    // Directory was created
    expect(parsed).toEqual(row);
    // Pretty-printed: 2-space indent means content has newlines
    expect(content).toContain("\n");
    expect(content).toContain("  ");
  });
});

// ---------------------------------------------------------------------------
// safeWrite
// ---------------------------------------------------------------------------

describe("safeWrite", () => {
  it("returns normally when writer succeeds", async () => {
    const writer = new InMemoryAuditWriter();
    const row = makeRow();
    await expect(safeWrite(writer, row)).resolves.toBeUndefined();
    expect(writer.rows).toHaveLength(1);
  });

  it("catches a thrown error, logs DD2 message to stderr, does not re-throw", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const throwingWriter = {
      write: async (_row: LlmCallRow): Promise<void> => {
        throw new Error("disk full");
      },
    };

    const row = makeRow({ block_id: "functional-status-grid" });

    // Must not throw
    await expect(safeWrite(throwingWriter, row)).resolves.toBeUndefined();

    const expectedMessage =
      "[audit:warn] failed to persist row for block 'functional-status-grid': disk full. Demo continues; audit row dropped.";

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expectedMessage);

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createAuditHook
// ---------------------------------------------------------------------------

describe("createAuditHook", () => {
  it("onFinish emits a row with all 12 fields populated", async () => {
    const opts = makeOpts();
    const hook = createAuditHook(opts);

    await hook.onFinish({
      text: "Hello world",
      usage: { promptTokens: 142, completionTokens: 88 },
      finishReason: "stop",
    });

    const writer = opts.writer as InMemoryAuditWriter;
    expect(writer.rows).toHaveLength(1);
    const row = writer.rows[0]!;

    expect(row.schema_version).toBe(1);
    expect(row.id).toBe("call-001");
    expect(row.ts).toBe("2026-01-01T00:00:00.000Z");
    expect(row.block_id).toBe("functional-status-grid");
    expect(row.block_kind).toBe("structured");
    expect(row.model).toBe("openai/gpt-4o");
    expect(row.prompt).toBe("");
    expect(row.response).toBe("Hello world");
    expect(row.tokens_in).toBe(142);
    expect(row.tokens_out).toBe(88);
    expect(row.latency_ms).toBe(0);
    expect(row.finish_reason).toBe("stop");
  });

  it("defaults tokens to 0 when result.usage is missing", async () => {
    const opts = makeOpts();
    const hook = createAuditHook(opts);

    await hook.onFinish({ text: "some text", finishReason: "stop" });

    const writer = opts.writer as InMemoryAuditWriter;
    const row = writer.rows[0]!;
    expect(row.tokens_in).toBe(0);
    expect(row.tokens_out).toBe(0);
  });

  it("defaults finish_reason to stop when missing", async () => {
    const opts = makeOpts();
    const hook = createAuditHook(opts);

    await hook.onFinish({ text: "some text" });

    const writer = opts.writer as InMemoryAuditWriter;
    const row = writer.rows[0]!;
    expect(row.finish_reason).toBe("stop");
  });

  it("produces byte-identical rows across two invocations under fake clock + fake id", async () => {
    let callCount = 0;
    const opts = makeOpts({
      makeId: () => {
        callCount++;
        return `call-${String(callCount).padStart(3, "0")}`;
      },
    });

    const result = {
      text: "Hello world",
      usage: { promptTokens: 142, completionTokens: 88 },
      finishReason: "stop",
    };

    const hook1 = createAuditHook(opts);
    await hook1.onFinish(result);

    // Reset counter for second invocation
    callCount = 0;
    const opts2 = makeOpts({
      writer: new InMemoryAuditWriter(),
      makeId: () => {
        callCount++;
        return `call-${String(callCount).padStart(3, "0")}`;
      },
    });
    const hook2 = createAuditHook(opts2);
    await hook2.onFinish(result);

    const writer1 = opts.writer as InMemoryAuditWriter;
    const writer2 = opts2.writer as InMemoryAuditWriter;

    const json1 = JSON.stringify(writer1.rows[0]);
    const json2 = JSON.stringify(writer2.rows[0]);

    expect(json1).toBe(json2);
  });
});
