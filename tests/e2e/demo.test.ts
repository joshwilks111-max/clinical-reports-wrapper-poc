/**
 * E2E test suite for src/demo.ts.
 *
 * Spawns `bun run src/demo.ts` as a child process in a temp working directory
 * that has templates/, fixtures/, and transcripts/ copied in. Asserts stdout
 * format, audit file shape, determinism, and the DD2 audit-dir collision path.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "demo-e2e-"));
  cpSync(join(REPO_ROOT, "templates"), join(dir, "templates"), {
    recursive: true,
  });
  cpSync(join(REPO_ROOT, "fixtures"), join(dir, "fixtures"), {
    recursive: true,
  });
  cpSync(join(REPO_ROOT, "transcripts"), join(dir, "transcripts"), {
    recursive: true,
  });
  return dir;
}

function runDemoIn(workDir: string) {
  return spawnSync("bun", ["run", join(REPO_ROOT, "src/demo.ts")], {
    cwd: workDir,
    encoding: "utf8",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("demo e2e", () => {
  test("exits 0 on a fresh working dir", () => {
    const dir = setupTempDir();
    const result = runDemoIn(dir);
    expect(result.status).toBe(0);
  });

  test("stdout structure matches DD1 spec", () => {
    const dir = setupTempDir();
    const result = runDemoIn(dir);
    expect(result.status).toBe(0);

    const stdout = result.stdout as string;
    const lines = stdout.split("\n");

    // Line 1: banner
    expect(lines[0]).toBe("clinical-reports-wrapper-poc — demo run");

    // Line 2: template / blocks / run ID
    expect(lines[1]).toContain("Template: acc-srna-skeleton");
    expect(lines[1]).toContain("Blocks: 3");
    expect(lines[1]).toContain("Run ID: 2026-01-01T00-00-00-000Z");

    // Block headers appear in order
    const headerLines = lines.filter((l) => l.match(/^\[\d+\/\d+\]/));
    expect(headerLines).toHaveLength(3);
    expect(headerLines[0]).toContain("[1/3] verbatim");
    expect(headerLines[1]).toContain("[2/3] structured");
    expect(headerLines[2]).toContain("[3/3] generative");

    // Verbatim header must NOT mention LLM
    expect(headerLines[0]).not.toContain("LLM call:");

    // Structured and generative headers must mention LLM
    expect(headerLines[1]).toContain("LLM call: openai/gpt-4o (canned)");
    expect(headerLines[2]).toContain("LLM call: openai/gpt-4o (canned)");

    // Final summary line
    const lastNonEmpty = lines.filter((l) => l.trim() !== "").at(-1);
    expect(lastNonEmpty).toMatch(
      /^Done\. 3 blocks · 2 LLM calls · audit\/2026-01-01T00-00-00-000Z\/ \(2 files\)$/,
    );
  });

  test("audit files are written with correct schema", () => {
    const dir = setupTempDir();
    const result = runDemoIn(dir);
    expect(result.status).toBe(0);

    const auditDir = join(dir, "audit", "2026-01-01T00-00-00-000Z");
    expect(existsSync(auditDir)).toBe(true);

    const call001Path = join(auditDir, "call-001.json");
    const call002Path = join(auditDir, "call-002.json");
    expect(existsSync(call001Path)).toBe(true);
    expect(existsSync(call002Path)).toBe(true);

    const row1 = JSON.parse(readFileSync(call001Path, "utf-8")) as Record<
      string,
      unknown
    >;
    const row2 = JSON.parse(readFileSync(call002Path, "utf-8")) as Record<
      string,
      unknown
    >;

    expect(row1["schema_version"]).toBe(1);
    expect(row1["block_kind"]).toBe("structured");
    expect(row1["model"]).toBe("openai/gpt-4o");

    expect(row2["schema_version"]).toBe(1);
    expect(row2["block_kind"]).toBe("generative");
    expect(row2["model"]).toBe("openai/gpt-4o");
  });

  test("two consecutive runs produce byte-identical stdout and audit files", () => {
    const dir1 = setupTempDir();
    const dir2 = setupTempDir();

    const r1 = runDemoIn(dir1);
    const r2 = runDemoIn(dir2);

    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);

    // Stdout must be identical
    expect(r1.stdout).toBe(r2.stdout);

    const auditSubdir = join("audit", "2026-01-01T00-00-00-000Z");

    // Both audit files must be identical between runs
    for (const filename of ["call-001.json", "call-002.json"]) {
      const content1 = readFileSync(join(dir1, auditSubdir, filename), "utf-8");
      const content2 = readFileSync(join(dir2, auditSubdir, filename), "utf-8");
      expect(content1).toBe(content2);
    }
  });

  test("DD2: exits non-zero with locked error message when audit is a file", () => {
    const dir = setupTempDir();

    // Create a regular file at the `audit` path before running the demo
    writeFileSync(join(dir, "audit"), "not a directory");

    const result = runDemoIn(dir);

    expect(result.status).not.toBe(0);
    expect(result.stderr as string).toContain(
      `Error: cannot create audit directory — 'audit/' is a file. Remove or rename it and re-run.`,
    );
  });

  test("clean stderr on error (no Bun stack frames) when fixture is missing", () => {
    // Smoke-test regression: replay-level errors used to bubble up uncaught,
    // surfacing the locked DD2 message PLUS a Bun stack trace. The top-level
    // try/catch in demo.ts now suppresses the trace and prints message only.
    const dir = setupTempDir();

    // Delete one of the canned fixtures so replay throws ENOENT
    rmSync(join(dir, "fixtures/llm-responses/clinical-impression.json"));

    const result = runDemoIn(dir);
    const stderr = result.stderr as string;

    // Exit code right
    expect(result.status).not.toBe(0);

    // The locked DD2 message is present
    expect(stderr).toContain(
      "Error: fixture for block 'clinical-impression' not found at fixtures/llm-responses/clinical-impression.json. Re-clone the repo or run 'bun run check --update' to regenerate.",
    );

    // No Bun stack frames or version banner leaking through
    expect(stderr).not.toMatch(/^\s+at\s+/m);
    expect(stderr).not.toMatch(/Bun v\d+\.\d+\.\d+/);
    expect(stderr).not.toContain("src/replay.ts:");
    expect(stderr).not.toContain("src/router.ts:");
  });
});
