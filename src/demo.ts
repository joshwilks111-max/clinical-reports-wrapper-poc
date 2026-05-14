/**
 * Demo entry point — `bun run demo` / `bun run src/demo.ts`
 *
 * Wires fixed clock + monotonic ID generator for deterministic output,
 * sets up the audit dir, loads the template, routes all blocks, and prints
 * the locked stdout format.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import type { TemplateBlock } from "./blocks.ts";
import { FileAuditWriter, InMemoryAuditWriter } from "./audit.ts";
import { createReplayLoader } from "./replay.ts";
import { route } from "./router.ts";
import type { AuditWriter, FormatterCtx, LlmCallRow } from "./types.ts";

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // Determinism primitives
  // -------------------------------------------------------------------------

  const FIXED_NOW = (): Date => new Date("2026-01-01T00:00:00.000Z");

  let counter = 0;
  const FIXED_MAKE_ID = (): string =>
    `call-${String(++counter).padStart(3, "0")}`;

  const runId = FIXED_NOW().toISOString().replace(/[:.]/g, "-");
  // → '2026-01-01T00-00-00-000Z'

  // -------------------------------------------------------------------------
  // Audit dir setup
  // -------------------------------------------------------------------------

  if (existsSync("audit") && !statSync("audit").isDirectory()) {
    console.error(
      `Error: cannot create audit directory — 'audit/' is a file. Remove or rename it and re-run.`,
    );
    process.exit(1);
  }

  // mkdirSync with recursive:true creates parent dirs as needed, so a separate
  // mkdirSync('audit') is redundant.
  mkdirSync(`audit/${runId}`, { recursive: true });

  // -------------------------------------------------------------------------
  // Wire FormatterCtx
  // -------------------------------------------------------------------------

  const fixturesDir = "fixtures/llm-responses";
  const replay = createReplayLoader(fixturesDir);

  const fileWriter = new FileAuditWriter(`audit/${runId}`);
  const memory = new InMemoryAuditWriter();
  // Composite writer: write to file first, then push to memory.rows ONLY on
  // success. If fileWriter throws, safeWrite catches the error and the row is
  // NOT in memory — keeping memory.rows honest about disk state.
  const audit: AuditWriter = {
    write: async (row: LlmCallRow): Promise<void> => {
      await fileWriter.write(row);
      await memory.write(row);
    },
  };

  const ctx: FormatterCtx = {
    replay,
    audit,
    now: FIXED_NOW,
    makeId: FIXED_MAKE_ID,
  };

  // -------------------------------------------------------------------------
  // Load template
  // -------------------------------------------------------------------------

  const templateId = "acc-srna-skeleton";
  const blocks = JSON.parse(
    readFileSync(`templates/${templateId}.json`, "utf-8"),
  ) as TemplateBlock[];

  // -------------------------------------------------------------------------
  // Route all blocks
  // -------------------------------------------------------------------------

  const rendered = await route(blocks, ctx);

  // -------------------------------------------------------------------------
  // Print locked stdout
  // -------------------------------------------------------------------------

  console.log(`clinical-reports-wrapper-poc — demo run`);
  console.log(
    `Template: ${templateId}    Blocks: ${blocks.length}    Run ID: ${runId}`,
  );

  // memory.rows is in insertion order: row[k] belongs to the k-th non-verbatim
  // block. Index by counting verbatim blocks skipped so far. Under FS failure
  // a row may be absent (composite writer pushes post-await); the header still
  // prints but flags the dropped audit so the stdout stays internally honest.
  let llmRowIndex = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const n = i + 1;
    const total = blocks.length;
    const kindPadded = block.kind.padEnd(13);

    // Blank line before each block section
    console.log("");

    if (block.kind === "verbatim") {
      console.log(`[${n}/${total}] ${kindPadded}· ${block.id}`);
    } else {
      const row = memory.rows[llmRowIndex];
      llmRowIndex++;
      const annotation = row
        ? `LLM call: ${row.model} (canned)`
        : `LLM call: (audit row dropped — see [audit:warn] above)`;
      console.log(
        `[${n}/${total}] ${kindPadded}· ${block.id}    ${annotation}`,
      );
    }

    console.log(rendered[i]);
  }

  // Blank line before summary
  console.log("");

  // memory.rows.length reflects successful writes only (composite writer pushes
  // post-await). fileCount is computed from memory.rows since composite ordering
  // guarantees 1:1 with on-disk files.
  const llmCallCount = memory.rows.length;
  const fileCount = llmCallCount;

  console.log(
    `Done. ${blocks.length} blocks · ${llmCallCount} LLM calls · audit/${runId}/ (${fileCount} files)`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (err: unknown) {
    // Surface the locked friendly message (from replay.ts / audit.ts / template
    // load) as clean stderr — no Bun stack trace, no developer-coded shape.
    // Founder sees the suggested fix, not a call stack.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
