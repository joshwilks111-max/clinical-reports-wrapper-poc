/**
 * Demo entry point — `bun run demo` / `bun run src/demo.ts`
 *
 * Wires fixed clock + monotonic ID generator for deterministic output (D-A2),
 * sets up the audit dir, loads the template, routes all blocks, and prints
 * the DD1-locked stdout format.
 *
 * Round 2b implementation (Task 10).
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import type { TemplateBlock } from "./blocks.ts";
import { FileAuditWriter, InMemoryAuditWriter } from "./audit.ts";
import { createReplayLoader } from "./replay.ts";
import { route } from "./router.ts";
import type { AuditWriter, FormatterCtx, LlmCallRow } from "./types.ts";

// ---------------------------------------------------------------------------
// Determinism primitives (D-A2)
// ---------------------------------------------------------------------------

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

let counter = 0;
const FIXED_MAKE_ID = () => `call-${String(++counter).padStart(3, "0")}`;

// ---------------------------------------------------------------------------
// Run ID
// ---------------------------------------------------------------------------

const runId = FIXED_NOW().toISOString().replace(/[:.]/g, "-");
// → '2026-01-01T00-00-00-000Z'

// ---------------------------------------------------------------------------
// Audit dir setup
// ---------------------------------------------------------------------------

if (existsSync("audit") && !statSync("audit").isDirectory()) {
  console.error(
    `Error: cannot create audit directory — 'audit/' is a file. Remove or rename it and re-run.`,
  );
  process.exit(1);
}

mkdirSync("audit", { recursive: true });
mkdirSync(`audit/${runId}`, { recursive: true });

// ---------------------------------------------------------------------------
// Wire FormatterCtx
// ---------------------------------------------------------------------------

const fixturesDir = "fixtures/llm-responses";
const replay = createReplayLoader(fixturesDir);

const fileWriter = new FileAuditWriter(`audit/${runId}`);
const memory = new InMemoryAuditWriter();
const audit: AuditWriter = {
  write: async (row: LlmCallRow) => {
    memory.write(row);
    await fileWriter.write(row);
  },
};

const ctx: FormatterCtx = {
  replay,
  audit,
  now: FIXED_NOW,
  makeId: FIXED_MAKE_ID,
};

// ---------------------------------------------------------------------------
// Load template
// ---------------------------------------------------------------------------

const templateId = "acc-srna-skeleton";
const blocks = JSON.parse(
  readFileSync(`templates/${templateId}.json`, "utf-8"),
) as TemplateBlock[];

// ---------------------------------------------------------------------------
// Route all blocks
// ---------------------------------------------------------------------------

const rendered = await route(blocks, ctx);

// ---------------------------------------------------------------------------
// Print DD1-locked stdout
// ---------------------------------------------------------------------------

// Banner
console.log(`clinical-reports-wrapper-poc — demo run`);
console.log(
  `Template: ${templateId}    Blocks: ${blocks.length}    Run ID: ${runId}`,
);

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
    // Find the audit row for this LLM block: memory.rows keeps insertion order
    // blocks[0] is verbatim (no row), blocks[1] → rows[0], blocks[2] → rows[1]
    const llmBlockIndex =
      i - blocks.slice(0, i).filter((b) => b.kind === "verbatim").length;
    const row = memory.rows[llmBlockIndex]!;
    console.log(
      `[${n}/${total}] ${kindPadded}· ${block.id}    LLM call: ${row.model} (canned)`,
    );
  }

  console.log(rendered[i]);
}

// Blank line before summary
console.log("");

const llmCallCount = memory.rows.length;
const fileCount = llmCallCount; // one JSON file per LLM call

console.log(
  `Done. ${blocks.length} blocks · ${llmCallCount} LLM calls · audit/${runId}/ (${fileCount} files)`,
);
