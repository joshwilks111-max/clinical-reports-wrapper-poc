/**
 * Replay loader — Lane C implementation (Task 8).
 *
 * Reads canned LLM responses from `${fixturesDir}/${blockId}.json`.
 * Used by formatters in replay mode (v1 PoC — no network, no API key).
 *
 * Failure messages are DD2-locked verbatim — do not paraphrase.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fixture, ReplayFn } from "./types.ts";

// ---------------------------------------------------------------------------
// assertFixtureShape
// ---------------------------------------------------------------------------

/**
 * Hand-rolled shape assertion (D-T2 — no zod).
 * Exported so Task 11 golden-check and other callers can reuse it.
 *
 * Checks every required field for presence and correct type.
 * On any violation throws with the DD2-locked missing-field message.
 */
export function assertFixtureShape(
  obj: unknown,
  blockId: string,
): asserts obj is Fixture {
  const required: { field: keyof Fixture; type: string }[] = [
    { field: "prompt", type: "string" },
    { field: "response", type: "string" },
    { field: "model", type: "string" },
    { field: "tokensIn", type: "number" },
    { field: "tokensOut", type: "number" },
    { field: "finishReason", type: "string" },
  ];

  const record = obj as Record<string, unknown>;

  for (const { field, type } of required) {
    // eslint-disable-next-line valid-typeof
    if (typeof record[field] !== type) {
      throw new Error(
        `Error: fixture '${blockId}' is missing required field '${field}'. Expected shape: { prompt, response, model, tokensIn, tokensOut, finishReason }.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// createReplayLoader
// ---------------------------------------------------------------------------

/**
 * Returns a ReplayFn that reads `${fixturesDir}/${blockId}.json`, validates
 * the shape, and resolves with the parsed Fixture.
 *
 * User-facing error messages use the canonical relative path
 * `fixtures/llm-responses/<blockId>.json` regardless of what `fixturesDir`
 * resolves to — the suggested-fix line in the message must make sense on a
 * fresh clone.
 */
export function createReplayLoader(fixturesDir: string): ReplayFn {
  return async (blockId: string, _prompt: string): Promise<Fixture> => {
    const filePath = join(fixturesDir, `${blockId}.json`);
    const canonicalPath = `fixtures/llm-responses/${blockId}.json`;

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Error: fixture for block '${blockId}' not found at ${canonicalPath}. Re-clone the repo or run 'bun run check --update' to regenerate.`,
        );
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Error: fixture at ${canonicalPath} is not valid JSON. Restore from git: 'git checkout ${canonicalPath}'.`,
      );
    }

    assertFixtureShape(parsed, blockId);

    return parsed;
  };
}
