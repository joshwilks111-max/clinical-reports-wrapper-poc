# TODOS

Seeded from the design brief at session start (2026-05-14). Implementer + future-Josh should append as work surfaces new gaps.

## v1.5 (post-PoC)

- **TD2 — Founder smoke test.** `scripts/founder-smoke-test.sh`: spawn a fresh clone, time `bun install + bun run demo` end-to-end, assert <60s. Currently the README's <60s claim is a vibe; this would turn it into a measured number. Deferred from v1 because dev-machine timings (warm cache) don't validate the founder experience — real measurement happens manually on a fresh machine first.
- **Live API mode (`--live`).** Behind a flag. Calls the real provider, still writes audit rows. Useful for adapter contract tests; not part of the founders demo.
- **HTML audit-row viz.** Render `audit/<runId>/*.json` as a small HTML page (no framework). Probably one `scripts/render-audit.ts` that emits a single `audit/<runId>/index.html`. Stretch UX.
- **Multi-template selection UX.** Right now `templates/acc-srna-skeleton.json` is the only template. `bun run demo --template <name>` to pick from a `templates/` dir of options. Useful once we have 2+ realistic templates.
- **`bun run check --update` polish.** Current spec writes new golden + logs. Could add a confirm-prompt or diff-preview step before overwrite.

## Known limitations carried from source plan

- No `json-rules-engine` integration.
- No real Heidi-shaped transcript-format alignment.
- No multi-clinician / persistence beyond the audit JSONs.
- No Dockerfile / Terraform / production-readiness theatre.

## From /review (2026-05-14) — deferred to a future session

These are findings raised by the post-ship review (multi-specialist + adversarial)
that we chose not to fix in `review-fixes-2026-05-14`. Fix order is suggested but
not load-bearing.

### Architecture decisions to make

- **I5 — Resolve `createAuditHook`'s fate.** The factory at `src/audit.ts:85` is
  exported and tested but unused in v1 — formatters build their own 13-field
  `LlmCallRow` inline. Two paths:
    1. Delete `createAuditHook` + its tests. v1.5 live mode would build rows
       directly in the AI SDK adapter that wraps `streamText`/`generateText`.
    2. Extract `buildLlmCallRow(ctx, block, fixture, blockKind)` helper, route
       both formatters AND `createAuditHook` through it. Single source of truth
       for row shape. Also: add `prompt: string` to `CreateAuditHookOpts` so v1.5
       callers don't accidentally emit rows with empty prompt.
  Recommend option 2 — keeps the v1.5 single-emission-point story honest.

### Cross-platform hardening

- **I12 — CI matrix on Windows + macOS.** Currently `.github/workflows/ci.yml`
  runs `ubuntu-latest` only. Cross-platform claim in README is unverified.
  Two findings below only fire on Windows:
  - **I2 — Sort `readdirSync` results in `scripts/check.ts:234`.** Unsorted
    `auditEntries[0]` picks platform-dependent order. With fixed clock there's
    only one dir, but a stale dir from a prior failed run or future real-clock
    run gives the wrong target. Add `.sort()` + take lexicographically last
    (= newest under ISO timestamps). Also: fail loudly when `auditEntries.length > 1`.
  - **CRLF in `wrapAt80`.** `src/formatters/generative.ts:53` splits on `\n` only.
    Windows-authored fixtures with CRLF leak `\r` into output and miscount line
    lengths. Add `text.replace(/\r\n?/g, "\n")` at the top of `wrapAt80`.

### Defensive UX (low-fire failure modes)

- **I1 — Sanity-check the summary line under audit-row drop.** With the I1 fix
  in `review-fixes-2026-05-14`, `memory.rows.length` reflects on-disk truth
  (composite writer pushes post-await). But the summary line still uses
  `memory.rows.length` for `fileCount` — under partial failure it stays internally
  consistent but doesn't actually count files on disk. Replace with
  `readdirSync(audit/${runId}).filter(f => f.endsWith('.json')).length` for a
  belt-and-braces measurement.
- **I6 — Cover non-ENOENT readFileSync errors in `replay.ts`.** EACCES (file
  locked by AV scanner), EISDIR (developer accidentally `mkdir`'d the fixture
  path), EBUSY (Windows file held open by editor) all bypass DD2 and surface as
  raw Node errors. Either add a second locked message ("fixture at X is
  unreadable: <code>. Check file permissions / close other processes.") or
  catch and re-raise with prefix.

### Test coverage gaps (above the 90% line gate but worth filling)

- **I13a — `FileAuditWriter` FS-write-failure path.** No test simulates
  `mkdirSync`/`writeFileSync` throwing. Easy: point `FileAuditWriter` at a path
  whose parent is a regular file (ENOTDIR).
- **I13b — `wrapAt80` boundary at exactly 80 chars.** Tests cover `<80` and `>80`
  but not `length === 80` (the `≤ WRAP_COL` branch boundary).
- **`structured.ts` lines 24, 29-31** — `assertGridShape` non-object / null /
  null-mobility / null-pain branches. Coverage at 93.65% misses these. Add three
  tests passing `response: "null"`, `response: "42"`, and
  `response: '{"mobility":null,...}'`.
- **E2E tests don't clean up temp dirs.** `tests/e2e/demo.test.ts` calls
  `setupTempDir()` but no `afterEach` `rmSync`. Accumulates over time on dev
  machines.
- **Determinism check could be tighter.** Currently runs two demos in two tmpdirs.
  A same-dir re-run would catch module-level counter drift (mitigated by the I3
  `main()` wrapper but worth pinning).
- **`router.test.ts` assertNever regex coupling.** `/unhandled block kind/` is
  brittle to the exact wording in `blocks.ts:assertNever`. Looser matcher
  (`expect.any(Error)` + assert no audit/replay calls) is more stable.
- **`scripts/check.test.ts:419` smoke test writes to the real working tree.**
  Convert to a tmp-dir copy of the repo so `bun test` is hermetic.

### Code style / readability

- **Stdout-vs-stderr convention on FAIL output.** `scripts/check.ts` writes diff
  bodies and the `FAIL:` summary line to stdout. Convention is stderr for
  failure detail so CI logs separate cleanly. Current tests pin the stdout
  expectation; flipping is a coordinated change.
- **`structured.ts:59` `renderTable` hardcodes column widths in template
  strings.** Works for v1's fixed fixture values; a future `walk_distance_m=1000`
  would silently misalign columns. Either compute padding from declared widths
  or add a boundary-value test.
