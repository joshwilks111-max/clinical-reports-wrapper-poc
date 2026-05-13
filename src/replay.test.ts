import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReplayLoader, assertFixtureShape } from "./replay.ts";
import type { Fixture } from "./types.ts";

// ---------------------------------------------------------------------------
// Temp dir helpers
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "replay-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const validFixture: Fixture = {
  prompt: "What is the patient's mobility status?",
  response: '{"mobility":{"walk_distance_m":50}}',
  model: "openai/gpt-4o",
  tokensIn: 142,
  tokensOut: 88,
  finishReason: "stop",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createReplayLoader", () => {
  test("fixture present and valid — returns parsed Fixture", async () => {
    writeFileSync(join(dir, "my-block.json"), JSON.stringify(validFixture));
    const replay = createReplayLoader(dir);
    const result = await replay("my-block", validFixture.prompt);
    expect(result).toEqual(validFixture);
  });

  test("fixture is JSON null — throws DD2 missing-field message (C2 regression)", async () => {
    // Without the null-guard, this would crash with `TypeError: Cannot read
    // properties of null` instead of the locked DD2 missing-field message.
    const blockId = "null-fixture";
    writeFileSync(join(dir, `${blockId}.json`), "null");
    const replay = createReplayLoader(dir);

    let thrown: Error | null = null;
    try {
      await replay(blockId, "any prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toBe(
      `Error: fixture '${blockId}' is missing required field 'prompt'. Expected shape: { prompt, response, model, tokensIn, tokensOut, finishReason }.`,
    );
  });

  test("fixture is JSON number — throws DD2 missing-field message (C2 regression)", async () => {
    const blockId = "number-fixture";
    writeFileSync(join(dir, `${blockId}.json`), "42");
    const replay = createReplayLoader(dir);

    let thrown: Error | null = null;
    try {
      await replay(blockId, "any prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("is missing required field 'prompt'");
  });

  test("fixture prompt mismatches template prompt — throws prompt-drift message (C3 regression)", async () => {
    // The audit row pairs (block.prompt, fixture.response). If the template
    // prompt drifts from the fixture's recorded prompt, the audit row would
    // claim the new prompt produced the old response. Replay must fail loudly.
    writeFileSync(join(dir, "drift-block.json"), JSON.stringify(validFixture));
    const replay = createReplayLoader(dir);

    let thrown: Error | null = null;
    try {
      await replay("drift-block", "EDITED template prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toBe(
      "Error: fixture 'drift-block' prompt does not match template prompt. The template has been edited since the fixture was recorded. Re-record the fixture or restore the template prompt to match.",
    );
  });

  test("fixture prompt matches template prompt — passes", async () => {
    writeFileSync(join(dir, "match-block.json"), JSON.stringify(validFixture));
    const replay = createReplayLoader(dir);
    // Same prompt verbatim — no mismatch
    const result = await replay("match-block", validFixture.prompt);
    expect(result).toEqual(validFixture);
  });

  test("fixture file missing — throws DD2 missing-fixture message", async () => {
    const replay = createReplayLoader(dir);
    const blockId = "nonexistent-block";
    const expectedMessage = `Error: fixture for block '${blockId}' not found at fixtures/llm-responses/${blockId}.json. Re-clone the repo or run 'bun run check --update' to regenerate.`;

    let thrown: Error | null = null;
    try {
      await replay(blockId, "some prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toBe(expectedMessage);
  });

  test("fixture is malformed JSON — throws DD2 malformed-JSON message", async () => {
    const blockId = "bad-json-block";
    writeFileSync(join(dir, `${blockId}.json`), "{ not valid json !!!");
    const replay = createReplayLoader(dir);
    const expectedMessage = `Error: fixture at fixtures/llm-responses/${blockId}.json is not valid JSON. Restore from git: 'git checkout fixtures/llm-responses/${blockId}.json'.`;

    let thrown: Error | null = null;
    try {
      await replay(blockId, "some prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toBe(expectedMessage);
  });

  test("fixture missing `prompt` field — throws DD2 schema message naming prompt", async () => {
    const blockId = "missing-prompt-block";
    const { prompt: _omitted, ...withoutPrompt } = validFixture;
    writeFileSync(join(dir, `${blockId}.json`), JSON.stringify(withoutPrompt));
    const replay = createReplayLoader(dir);

    let thrown: Error | null = null;
    try {
      await replay(blockId, "some prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("is missing required field");
    expect(thrown!.message).toContain("prompt");
  });

  test("fixture missing `tokensIn` field — throws DD2 schema message naming tokensIn", async () => {
    const blockId = "missing-tokensin-block";
    const { tokensIn: _omitted, ...withoutTokensIn } = validFixture;
    writeFileSync(
      join(dir, `${blockId}.json`),
      JSON.stringify(withoutTokensIn),
    );
    const replay = createReplayLoader(dir);

    let thrown: Error | null = null;
    try {
      await replay(blockId, "some prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("is missing required field");
    expect(thrown!.message).toContain("tokensIn");
  });

  test("fixture has `tokensOut` as string instead of number — throws DD2 schema message naming tokensOut", async () => {
    const blockId = "wrong-type-block";
    const badFixture = { ...validFixture, tokensOut: "not-a-number" };
    writeFileSync(join(dir, `${blockId}.json`), JSON.stringify(badFixture));
    const replay = createReplayLoader(dir);

    let thrown: Error | null = null;
    try {
      await replay(blockId, "some prompt");
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain("is missing required field");
    expect(thrown!.message).toContain("tokensOut");
  });
});

describe("assertFixtureShape (exported)", () => {
  test("can be called directly — passes on valid shape, throws on invalid", () => {
    // Sanity: valid fixture passes without throwing
    expect(() => assertFixtureShape(validFixture, "test-block")).not.toThrow();

    // Invalid: missing response field
    expect(() =>
      assertFixtureShape({ ...validFixture, response: 42 }, "test-block"),
    ).toThrow(/is missing required field/);
  });
});
