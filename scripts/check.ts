/**
 * Golden-file regression gate — `bun run check` / `bun run check --update`
 *
 * Task 11 implementation. Runs the demo, diffs audit output against
 * golden/audit/, and exits 0 on match or 1 on diff.
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testability)
// ---------------------------------------------------------------------------

export interface DiffResult {
  matches: string[];
  diffs: string[];
  missing: string[];
  extra: string[];
}

/**
 * Compares JSON files in auditDir against goldenDir.
 * Returns lists of matches, diffs, missing (in audit but not golden), and
 * extra (in golden but not audit).
 * Ignores .gitkeep — only compares .json files.
 */
export function diffAudit(auditDir: string, goldenDir: string): DiffResult {
  const result: DiffResult = {
    matches: [],
    diffs: [],
    missing: [],
    extra: [],
  };

  const auditFiles = readdirSync(auditDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const goldenFiles = existsSync(goldenDir)
    ? readdirSync(goldenDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];

  const goldenSet = new Set(goldenFiles);
  const auditSet = new Set(auditFiles);

  // Check audit files against golden
  for (const file of auditFiles) {
    if (!goldenSet.has(file)) {
      result.missing.push(file);
      continue;
    }

    const auditContent = readFileSync(join(auditDir, file), "utf-8");
    const goldenContent = readFileSync(join(goldenDir, file), "utf-8");

    const auditObj = JSON.parse(auditContent) as unknown;
    const goldenObj = JSON.parse(goldenContent) as unknown;

    const auditPretty = JSON.stringify(auditObj, null, 2);
    const goldenPretty = JSON.stringify(goldenObj, null, 2);

    if (auditPretty === goldenPretty) {
      result.matches.push(file);
    } else {
      // Produce a simple line-by-line diff with 5-line context
      const diff = lineDiff(goldenPretty, auditPretty, file);
      result.diffs.push(diff);
    }
  }

  // Check golden files not present in audit
  for (const file of goldenFiles) {
    if (!auditSet.has(file)) {
      result.extra.push(file);
    }
  }

  return result;
}

/**
 * Produces a simple unified-style diff between two strings.
 * Shows up to 5 lines of context around changes.
 */
function lineDiff(expected: string, actual: string, label: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const CONTEXT = 5;

  const lines: string[] = [`DIFF in ${label}:`];
  const maxLen = Math.max(expectedLines.length, actualLines.length);

  // Find changed line indices
  const changedIndices = new Set<number>();
  for (let i = 0; i < maxLen; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      changedIndices.add(i);
    }
  }

  // Expand to context window
  const showIndices = new Set<number>();
  for (const idx of changedIndices) {
    for (let c = idx - CONTEXT; c <= idx + CONTEXT; c++) {
      if (c >= 0 && c < maxLen) {
        showIndices.add(c);
      }
    }
  }

  let prevShown = -1;
  for (const i of Array.from(showIndices).sort((a, b) => a - b)) {
    if (prevShown !== -1 && i > prevShown + 1) {
      lines.push("  ...");
    }
    if (changedIndices.has(i)) {
      if (i < expectedLines.length) {
        lines.push(`- ${expectedLines[i] ?? ""}`);
      }
      if (i < actualLines.length) {
        lines.push(`+ ${actualLines[i] ?? ""}`);
      }
    } else {
      lines.push(`  ${expectedLines[i] ?? actualLines[i] ?? ""}`);
    }
    prevShown = i;
  }

  return lines.join("\n");
}

/**
 * Copies all .json files from auditDir into goldenDir, removing any .json
 * files in goldenDir that are not in auditDir. Creates goldenDir if needed.
 * Returns the list of files updated.
 */
export function updateGolden(auditDir: string, goldenDir: string): string[] {
  mkdirSync(goldenDir, { recursive: true });

  const auditFiles = readdirSync(auditDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const goldenFiles = existsSync(goldenDir)
    ? readdirSync(goldenDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];

  const auditSet = new Set(auditFiles);

  // Remove golden files not in audit
  for (const file of goldenFiles) {
    if (!auditSet.has(file)) {
      rmSync(join(goldenDir, file));
    }
  }

  // Copy audit files to golden
  const updated: string[] = [];
  for (const file of auditFiles) {
    const content = readFileSync(join(auditDir, file), "utf-8");
    writeFileSync(join(goldenDir, file), content);
    updated.push(file);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// CLI runner (exported so tests can exercise the full path without subprocess)
// ---------------------------------------------------------------------------

export interface RunCliOpts {
  /** Override working directory for audit/ and golden/ resolution. Defaults to process.cwd(). */
  cwd?: string;
  /** Override --update flag detection. Defaults to process.argv.includes('--update'). */
  update?: boolean;
  /** Override the demo runner. Defaults to spawnSync('bun', ['run', 'src/demo.ts']). */
  runDemo?: (cwd: string) => { status: number | null; stderr: string };
  /** Override output sink. Defaults to console.log / console.error. */
  out?: (msg: string) => void;
  err?: (msg: string) => void;
  /** Override process.exit. Defaults to process.exit. */
  exit?: (code: number) => never;
}

export function runCli(opts: RunCliOpts = {}): void {
  const cwd = opts.cwd ?? process.cwd();
  const isUpdate = opts.update ?? process.argv.includes("--update");
  const out = opts.out ?? ((m) => console.log(m));
  const err = opts.err ?? ((m) => console.error(m));
  const exit = opts.exit ?? ((code) => process.exit(code));
  const runDemo =
    opts.runDemo ??
    ((dir) => {
      const r = spawnSync("bun", ["run", "src/demo.ts"], {
        encoding: "utf8",
        cwd: dir,
      });
      return { status: r.status, stderr: r.stderr ?? "" };
    });

  const AUDIT_ROOT = join(cwd, "audit");
  const GOLDEN_DIR = join(cwd, "golden/audit");

  // Run the demo
  const demoResult = runDemo(cwd);
  if (demoResult.status !== 0) {
    err(`demo run failed: ${demoResult.stderr}`);
    exit(1);
    return;
  }

  // Locate produced audit dir
  if (!existsSync(AUDIT_ROOT)) {
    err("audit/ missing — demo did not produce output");
    exit(1);
    return;
  }

  const auditEntries = readdirSync(AUDIT_ROOT).filter((e) => {
    try {
      return statSync(join(AUDIT_ROOT, e)).isDirectory();
    } catch {
      return false;
    }
  });

  if (auditEntries.length === 0) {
    err("audit/ missing — demo did not produce output");
    exit(1);
    return;
  }

  // Pick the first (and with fixed clock, only) run dir
  const runDir = join(AUDIT_ROOT, auditEntries[0]!);

  // --update mode
  if (isUpdate) {
    if (!existsSync(GOLDEN_DIR)) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
    }
    const updated = updateGolden(runDir, GOLDEN_DIR);
    for (const file of updated) {
      out(`UPDATED golden/audit/${file}`);
    }
    out(`UPDATED golden/audit/ (${updated.length} files)`);
    exit(0);
    return;
  }

  // Normal diff mode
  if (!existsSync(GOLDEN_DIR)) {
    err(
      "golden/audit/ does not exist — run 'bun run check --update' to seed it",
    );
    exit(1);
    return;
  }

  const result = diffAudit(runDir, GOLDEN_DIR);

  if (
    result.diffs.length === 0 &&
    result.missing.length === 0 &&
    result.extra.length === 0
  ) {
    out(`OK: ${result.matches.length} calls match golden`);
    exit(0);
    return;
  }

  // Print diffs
  for (const diff of result.diffs) {
    out(diff);
  }
  for (const file of result.missing) {
    out(`MISSING golden: ${file}`);
  }
  for (const file of result.extra) {
    out(`EXTRA in golden: ${file}`);
  }

  out(
    `FAIL: ${result.diffs.length} diff(s), ${result.missing.length} missing, ${result.extra.length} extra`,
  );
  exit(1);
}

// ---------------------------------------------------------------------------
// Entry point — only runs when invoked directly, not when imported by tests
// ---------------------------------------------------------------------------

if (import.meta.main) {
  runCli();
}
