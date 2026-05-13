/**
 * Tests for scripts/check.ts pure helpers + CLI runner.
 *
 * Uses temp dirs throughout — never touches real golden/audit/.
 * runCli() is tested in-process via its opts injection seams, so the
 * CLI body lines count toward coverage without spawning a subprocess.
 * One subprocess smoke test at the end catches argv + path resolution.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diffAudit, updateGolden, runCli } from "./check.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "check-test-"));
}

/** Write a minimal LlmCallRow-shaped JSON file into dir under name. */
function writeCallJson(
  dir: string,
  name: string,
  overrides: Record<string, unknown> = {},
): void {
  const row = {
    schema_version: 1,
    id: name.replace(".json", ""),
    ts: "2026-01-01T00:00:00.000Z",
    block_id: "functional-status-grid",
    block_kind: "structured",
    model: "openai/gpt-4o",
    prompt: "",
    response: '{"mobility":{"walk_distance_m":50},"pain":{"vas":7}}',
    tokens_in: 142,
    tokens_out: 88,
    latency_ms: 0,
    finish_reason: "stop",
    ...overrides,
  };
  writeFileSync(join(dir, name), JSON.stringify(row, null, 2));
}

// ---------------------------------------------------------------------------
// Per-test temp dirs
// ---------------------------------------------------------------------------

let auditDir: string;
let goldenDir: string;

beforeEach(() => {
  auditDir = makeTmpDir();
  goldenDir = makeTmpDir();
});

afterEach(() => {
  rmSync(auditDir, { recursive: true, force: true });
  rmSync(goldenDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// diffAudit
// ---------------------------------------------------------------------------

describe("diffAudit", () => {
  test("all match — empty diffs/missing/extra, all files in matches", () => {
    writeCallJson(auditDir, "call-001.json");
    writeCallJson(auditDir, "call-002.json");
    writeCallJson(goldenDir, "call-001.json");
    writeCallJson(goldenDir, "call-002.json");

    const result = diffAudit(auditDir, goldenDir);

    expect(result.matches).toEqual(["call-001.json", "call-002.json"]);
    expect(result.diffs).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  test("one file differs — reported in diffs, other in matches", () => {
    writeCallJson(auditDir, "call-001.json");
    writeCallJson(auditDir, "call-002.json");
    writeCallJson(goldenDir, "call-001.json");
    writeCallJson(goldenDir, "call-002.json", { tokens_in: 999 });

    const result = diffAudit(auditDir, goldenDir);

    expect(result.matches).toEqual(["call-001.json"]);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toContain("DIFF in call-002.json");
    expect(result.diffs[0]).toContain("999");
    expect(result.missing).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  test("golden missing one file present in audit — reports in missing", () => {
    writeCallJson(auditDir, "call-001.json");
    writeCallJson(auditDir, "call-002.json");
    writeCallJson(goldenDir, "call-001.json");

    const result = diffAudit(auditDir, goldenDir);

    expect(result.matches).toEqual(["call-001.json"]);
    expect(result.missing).toEqual(["call-002.json"]);
    expect(result.diffs).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });

  test("golden has extra file not in audit — reports in extra", () => {
    writeCallJson(auditDir, "call-001.json");
    writeCallJson(goldenDir, "call-001.json");
    writeCallJson(goldenDir, "call-003.json");

    const result = diffAudit(auditDir, goldenDir);

    expect(result.matches).toEqual(["call-001.json"]);
    expect(result.extra).toEqual(["call-003.json"]);
    expect(result.diffs).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  test("ignores .gitkeep and non-.json files in both dirs", () => {
    writeCallJson(auditDir, "call-001.json");
    writeFileSync(join(auditDir, ".gitkeep"), "");
    writeCallJson(goldenDir, "call-001.json");
    writeFileSync(join(goldenDir, ".gitkeep"), "");

    const result = diffAudit(auditDir, goldenDir);

    expect(result.matches).toEqual(["call-001.json"]);
    expect(result.diffs).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
    expect(result.extra).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateGolden
// ---------------------------------------------------------------------------

describe("updateGolden", () => {
  test("copies audit files into golden, returns list of updated files", () => {
    writeCallJson(auditDir, "call-001.json");
    writeCallJson(auditDir, "call-002.json");

    const updated = updateGolden(auditDir, goldenDir);

    expect(updated.sort()).toEqual(["call-001.json", "call-002.json"]);
    const goldenFiles = readdirSync(goldenDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(goldenFiles).toEqual(["call-001.json", "call-002.json"]);

    const audit001 = readFileSync(join(auditDir, "call-001.json"), "utf-8");
    const golden001 = readFileSync(join(goldenDir, "call-001.json"), "utf-8");
    expect(audit001).toBe(golden001);
  });

  test("removes extra golden files not in audit", () => {
    writeCallJson(auditDir, "call-001.json");
    writeCallJson(goldenDir, "call-001.json");
    writeCallJson(goldenDir, "call-stale.json");

    updateGolden(auditDir, goldenDir);

    const goldenFiles = readdirSync(goldenDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(goldenFiles).toEqual(["call-001.json"]);
  });

  test("creates goldenDir if it does not exist", () => {
    rmSync(goldenDir, { recursive: true, force: true });
    writeCallJson(auditDir, "call-001.json");

    const updated = updateGolden(auditDir, goldenDir);

    expect(updated).toEqual(["call-001.json"]);
    const goldenFiles = readdirSync(goldenDir).filter((f) =>
      f.endsWith(".json"),
    );
    expect(goldenFiles).toEqual(["call-001.json"]);
  });
});

// ---------------------------------------------------------------------------
// runCli — in-process tests via opts injection
// ---------------------------------------------------------------------------

describe("runCli", () => {
  /** Build a fake CWD with audit/<runId>/ and optional golden/audit/ already populated. */
  function makeCliDirs(opts: {
    auditFiles?: Record<string, unknown>;
    goldenFiles?: Record<string, unknown>;
    skipGolden?: boolean;
  }): { cwd: string; cleanup: () => void } {
    const cwd = makeTmpDir();
    const runId = "2026-01-01T00-00-00-000Z";
    const runDir = join(cwd, "audit", runId);
    mkdirSync(runDir, { recursive: true });

    for (const [name, overrides] of Object.entries(opts.auditFiles ?? {})) {
      writeCallJson(runDir, name, overrides as Record<string, unknown>);
    }

    if (!opts.skipGolden) {
      const goldenAudit = join(cwd, "golden", "audit");
      mkdirSync(goldenAudit, { recursive: true });
      for (const [name, overrides] of Object.entries(opts.goldenFiles ?? {})) {
        writeCallJson(goldenAudit, name, overrides as Record<string, unknown>);
      }
    }

    return {
      cwd,
      cleanup: () => rmSync(cwd, { recursive: true, force: true }),
    };
  }

  /** Collect output and capture exit code without actually calling process.exit. */
  function captureRun(
    cwd: string,
    update: boolean,
  ): { stdout: string[]; stderr: string[]; exitCode: number } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode = -1;

    runCli({
      cwd,
      update,
      runDemo: () => ({ status: 0, stderr: "" }), // demo already ran; audit dir is pre-populated
      out: (m) => stdout.push(m),
      err: (m) => stderr.push(m),
      exit: (code) => {
        exitCode = code;
        // Throw to stop execution (simulates process.exit)
        throw new Error(`__exit__${code}`);
      },
    });

    return { stdout, stderr, exitCode };
  }

  function safeRun(
    cwd: string,
    update: boolean,
  ): { stdout: string[]; stderr: string[]; exitCode: number } {
    try {
      return captureRun(cwd, update);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("__exit__")) {
        // exitCode already captured inside captureRun before throw
        // Re-read by catching here
        const code = parseInt(e.message.replace("__exit__", ""), 10);
        return { stdout: [], stderr: [], exitCode: code };
      }
      throw e;
    }
  }

  /** Full capture that collects output before exit throws. */
  function fullRun(
    cwd: string,
    update: boolean,
  ): { stdout: string[]; stderr: string[]; exitCode: number } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode = -1;

    try {
      runCli({
        cwd,
        update,
        runDemo: () => ({ status: 0, stderr: "" }),
        out: (m) => stdout.push(m),
        err: (m) => stderr.push(m),
        exit: (code) => {
          exitCode = code;
          throw new Error(`__exit__${code}`);
        },
      });
    } catch (e) {
      if (!(e instanceof Error && e.message.startsWith("__exit__"))) throw e;
    }

    return { stdout, stderr, exitCode };
  }

  test("all match — exits 0, prints OK line", () => {
    const { cwd, cleanup } = makeCliDirs({
      auditFiles: { "call-001.json": {}, "call-002.json": { id: "call-002" } },
      goldenFiles: { "call-001.json": {}, "call-002.json": { id: "call-002" } },
    });
    try {
      const { stdout, exitCode } = fullRun(cwd, false);
      expect(exitCode).toBe(0);
      expect(stdout.join("\n")).toMatch(/^OK: 2 calls match golden/m);
    } finally {
      cleanup();
    }
  });

  test("diff detected — exits 1, prints FAIL line", () => {
    const { cwd, cleanup } = makeCliDirs({
      auditFiles: { "call-001.json": {} },
      goldenFiles: { "call-001.json": { tokens_in: 999 } },
    });
    try {
      const { stdout, exitCode } = fullRun(cwd, false);
      expect(exitCode).toBe(1);
      expect(stdout.join("\n")).toMatch(/FAIL:/);
      expect(stdout.join("\n")).toMatch(/DIFF in call-001\.json/);
    } finally {
      cleanup();
    }
  });

  test("golden missing — exits 1, prints FAIL line with missing entry", () => {
    const { cwd, cleanup } = makeCliDirs({
      auditFiles: { "call-001.json": {}, "call-002.json": { id: "call-002" } },
      goldenFiles: { "call-001.json": {} },
    });
    try {
      const { stdout, exitCode } = fullRun(cwd, false);
      expect(exitCode).toBe(1);
      expect(stdout.join("\n")).toMatch(/MISSING golden: call-002\.json/);
    } finally {
      cleanup();
    }
  });

  test("golden has extra — exits 1, prints EXTRA line", () => {
    const { cwd, cleanup } = makeCliDirs({
      auditFiles: { "call-001.json": {} },
      goldenFiles: {
        "call-001.json": {},
        "call-extra.json": { id: "call-extra" },
      },
    });
    try {
      const { stdout, exitCode } = fullRun(cwd, false);
      expect(exitCode).toBe(1);
      expect(stdout.join("\n")).toMatch(/EXTRA in golden: call-extra\.json/);
    } finally {
      cleanup();
    }
  });

  test("--update mode — seeds golden from audit, exits 0", () => {
    const { cwd, cleanup } = makeCliDirs({
      auditFiles: { "call-001.json": {}, "call-002.json": { id: "call-002" } },
      skipGolden: true,
    });
    try {
      const { stdout, exitCode } = fullRun(cwd, true);
      expect(exitCode).toBe(0);
      expect(stdout.join("\n")).toMatch(/UPDATED golden\/audit\/ \(2 files\)/);
      const goldenFiles = readdirSync(join(cwd, "golden", "audit"))
        .filter((f) => f.endsWith(".json"))
        .sort();
      expect(goldenFiles).toEqual(["call-001.json", "call-002.json"]);
    } finally {
      cleanup();
    }
  });

  test("demo run fails — exits 1 with error message", () => {
    const cwd = makeTmpDir();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode = -1;
    try {
      runCli({
        cwd,
        update: false,
        runDemo: () => ({ status: 1, stderr: "fixture missing" }),
        out: (m) => stdout.push(m),
        err: (m) => stderr.push(m),
        exit: (code) => {
          exitCode = code;
          throw new Error(`__exit__${code}`);
        },
      });
    } catch (e) {
      if (!(e instanceof Error && e.message.startsWith("__exit__"))) throw e;
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("demo run failed");
  });

  test("golden dir missing in normal mode — exits 1 with seed hint", () => {
    const { cwd, cleanup } = makeCliDirs({
      auditFiles: { "call-001.json": {} },
      skipGolden: true,
    });
    try {
      const { stderr, exitCode } = fullRun(cwd, false);
      expect(exitCode).toBe(1);
      expect(stderr.join("\n")).toContain(
        "golden/audit/ does not exist — run 'bun run check --update' to seed it",
      );
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Subprocess smoke test — real CLI against real repo
// ---------------------------------------------------------------------------

describe("CLI smoke test", () => {
  test("bun run check exits 0 and stdout starts with OK:", () => {
    const result = Bun.spawnSync(["bun", "run", "scripts/check.ts"], {
      cwd: process.cwd(),
      stderr: "pipe",
    });

    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toMatch(/^OK:/m);
  });
});
