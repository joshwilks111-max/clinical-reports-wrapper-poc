# Changelog

All notable changes to clinical-reports-wrapper-poc land here.

## [0.1.2] - 2026-05-14

Smoke-test follow-up. The cold-clone end-to-end smoke (clone + install + demo, total 2s) surfaced one founder-experience gap that /review had missed.

### Fixed
- **Demo no longer leaks Bun stack traces on error.** When a fixture was missing or the audit-row pipeline threw, the locked DD2 message printed correctly but a Bun stack trace and version banner followed underneath — founder-coded shape, not the friendly one. Wrapped the entry-point `await main()` in a try/catch that surfaces `err.message` only and exits 1. The DD2 message text is unchanged; only the noise after it is gone.

### Tests
- New e2e regression: `tests/e2e/demo.test.ts` asserts stderr contains the locked DD2 message AND contains zero `at ` stack frames, zero `Bun vX.Y.Z` lines, and no internal source paths after a fixture is deleted. 72 tests pass.

## [0.1.1] - 2026-05-14

Post-ship review fixes. 3 real bugs caught by the multi-specialist + adversarial pass, plus an AUTO-FIX bundle from the same review.

### Fixed
- **Audit hook now catches synchronous throws.** `safeWrite` previously only handled rejected promises; sync `mkdirSync`/`writeFileSync` failures from `FileAuditWriter` escaped before `.catch()` could attach, violating the "audit failure must NOT break the user-facing call" rule. Converted to `async/await` with `try/catch` — catches both shapes now.
- **Fixture loader handles `null` and primitives.** A fixture file containing literal `null` (or a JSON number/string) crashed with a raw `TypeError` instead of the locked missing-field message. Added a typeof-object guard before the cast.
- **Replay loader verifies prompt match.** The loader was discarding the `prompt` argument entirely. If a template prompt drifted from its fixture, the audit row would silently pair the new prompt with the old response — a credibility-surface lie. Now compares `parsed.prompt` against the passed-in prompt and throws clearly on mismatch.

### Changed
- **`src/demo.ts` is now import-safe.** Wrapped the demo body in `async main()` with `import.meta.main` guard. Importing the file no longer runs the demo as a side effect. Counter and runId computation moved inside `main()` so each invocation resets cleanly.
- **Composite audit writer is honest under partial failure.** `memory.rows` now writes file first, then pushes to memory only on success. `memory.rows.length` reflects on-disk truth instead of intent. Print loop tolerates dropped audit rows gracefully.
- **`diffAudit` no longer crashes on corrupted golden files.** `JSON.parse` now in `try/catch`; malformed JSON surfaces as a structured `DIFF in <file>: ... is malformed` line instead of a raw `SyntaxError`.

### Removed
- Dead `safeRun` and `captureRun` helpers from `scripts/check.test.ts`, plus unused `spyOn` import.
- Redundant `mkdirSync('audit')` call from `src/demo.ts` — the next line creates `audit/${runId}` with `recursive: true` which handles the parent.
- "Lane A/B/C" / "Task N" / "Round 0" build-process scaffolding from docstrings. Replaced with substantive descriptions of what each module does.

### Tests
- Coverage rose from 62 → 71 tests. Aggregate line coverage 98.04% (gate ≥0.9).
- New regression tests: sync-throw, non-Error rejection, partial-usage tokens, `null`/number fixture body, prompt-drift mismatch + match, malformed audit JSON, malformed golden JSON.

## [0.1.0] - 2026-05-13

Initial drop. Block-routing PoC: 3 block types (verbatim / structured / generative), `switch (block.kind)` router with `assertNever` fallback, single audit emission point with sync + async catch, golden-file regression gate via `bun run check`, ACC SRNA skeleton template with two canned LLM fixtures.

Run `bun install && bun run demo` for the founders-test demo. 62 tests, line coverage gate enforced in CI.
