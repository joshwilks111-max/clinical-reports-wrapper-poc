# clinical-reports-wrapper-poc — block-routing PoC

> **For agentic workers:** Use `superpowers:subagent-driven-development` for sequential rounds and `superpowers:dispatching-parallel-agents` for Round 1 (3 independent lanes). Source plan: `~/.gstack/projects/Heidi/josh-heidi-wrapper-repo-design-20260513.md`.

## Goal

A standalone, runnable proof-of-concept that lands the **block-per-block routing** thesis in <5 minutes from cold clone. A founder clones the repo, runs `bun run demo`, watches three blocks (verbatim / structured / generative) route through a `switch` to deterministic formatters, opens an audit JSON, and goes: *"oh — this guy knows how Heidi Reports should actually be built."*

This is a **brand-new repo** at `C:\Users\joshw\clinical-reports-wrapper-poc`. Do **not** touch the existing `clinical-reports-wrapper` codebase — the PoC's neutrality is the point. The existing wrapper is referenced only as a reuse-pointer for type-shape and audit-pattern (see "Reuse pointers" table below).

## Architecture (locked)

- **`TemplateBlock`** is a tagged union: `verbatim | structured | generative`.
- **`route()`** is a `switch (block.kind)` with `assertNever` fallback (D-A3) — the switch IS the thesis; reader sees dispatch literally.
- **Verbatim** formatters return fixed text, never call the LLM.
- **Structured** formatters get LLM JSON, validate shape, render into a known table.
- **Generative** formatters wrap a LLM string output.
- **Audit hook** (D-A1) attaches via AI SDK `experimental_telemetry.onFinish`. Single emission point per CLAUDE.md hard rule. Fires once per LLM call. Replay determinism via injected `now: () => Date` and `makeId: () => string` (D-A2).
- **Canned LLM responses** replay from `fixtures/llm-responses/<block-id>.json`. No network, no API key. Live mode deferred to v1.5.

## Tech stack (locked)

- TypeScript 5.x strict mode
- Bun runtime + `bun:test`
- AI SDK (Vercel) — only for the `experimental_telemetry` shape; not invoked for real LLM calls in v1
- No zod (D-T2 — hand-rolled validator)
- GitHub Actions CI with hard-fail 90% coverage gate (D-T3)

## Reuse pointers (read-only reference)

Spend ~15 minutes reading the existing wrapper before writing code. **Read for shape, do not copy-paste or import.**

| File | Take | Leave |
|---|---|---|
| `C:\Users\joshw\clinical-reports-wrapper\lib\wrapper\blocks.ts` | Tagged-union shape + `is*` discriminator pattern | ACC652 vocabulary, `EvidenceSpec`, `SourceConfig` |
| `C:\Users\joshw\clinical-reports-wrapper\lib\wrapper\audit.ts` | `LlmCallRow` type shape, `AuditWriter` interface, `InMemoryAuditWriter`, `createTelemetryHook`, `experimental_telemetry.onFinish` pattern | `sanitized_text` field name, `report_id`/`trace_id` fields, Supabase factory |
| `C:\Users\joshw\clinical-reports-wrapper\lib\wrapper\audit.test.ts` | onFinish-fires-once-per-call assertions, `usage ?? {promptTokens:0, completionTokens:0}` defensive shape | Supabase integration scaffold |
| `C:\Users\joshw\clinical-reports-wrapper\lib\adapters\heidi.ts` | Replay-fixture loader pattern | Real Heidi `third_party_template` path |
| `C:\Users\joshw\clinical-reports-wrapper\lib\adapters\replay-fixtures\heidi-ioa01-jane-smith.json` | Fixture-shape reference | Heidi-specific transcript content |

---

## Tasks

### Task 1: Scaffold repo

**Files:**
- `package.json` (create)
- `tsconfig.json` (create)
- `.gitignore` (create)
- `.editorconfig` (create)
- `bunfig.toml` (create)
- `README.md` (create — placeholder, real copy lands in Task 12)
- `LICENSE` (create — MIT)
- `TODOS.md` (create — seeded with TD2 from source plan)

**Steps:**

- [ ] Run `bun init -y` in `C:\Users\joshw\clinical-reports-wrapper-poc` (after `mkdir`).
- [ ] Pin Bun version and add scripts in `package.json`:
  ```json
  {
    "name": "clinical-reports-wrapper-poc",
    "private": false,
    "type": "module",
    "scripts": {
      "demo": "bun run src/demo.ts",
      "check": "bun run scripts/check.ts",
      "test": "bun test --coverage --coverage-reporter=text --coverage-reporter=lcov",
      "lint": "tsc --noEmit",
      "typecheck": "tsc --noEmit"
    },
    "devDependencies": {
      "typescript": "^5.6.0",
      "@types/bun": "latest"
    }
  }
  ```
- [ ] `tsconfig.json`: `"strict": true`, `"target": "esnext"`, `"module": "esnext"`, `"moduleResolution": "bundler"`, `"types": ["bun-types"]`, `"noUncheckedIndexedAccess": true`.
- [ ] `.gitignore`: `node_modules/`, `bun.lockb` (decide: commit lockfile — yes for reproducible CI), `audit/` (runtime output), `coverage/`, `*.log`, `.debug.log`.
  - **Note:** `golden/audit/` is **committed** (regression-guard for `bun run check`), `audit/` is **gitignored** (runtime).
- [ ] `TODOS.md` seeded with: TD2 (`scripts/founder-smoke-test.sh` v1.5 — measure cold-clone <60s); D-D2 stretch goals (live mode `--live`, HTML audit-row viz, multi-template UX).
- [ ] Commit: `chore: scaffold clinical-reports-wrapper-poc`.

**Verification:**
```bash
cd C:\Users\joshw\clinical-reports-wrapper-poc
bun install
bun run typecheck   # should pass on empty src
git log --oneline   # 1 commit
```

---

### Task 2: Types — `src/blocks.ts` + type contracts for downstream

**Files:**
- `src/blocks.ts` (create)
- `src/types.ts` (create — audit/replay/formatter interface contracts only)
- `src/blocks.test.ts` (create)

**Steps:**

- [ ] Define `TemplateBlock` tagged union in `src/blocks.ts`:
  ```ts
  export interface VerbatimBlock { kind: 'verbatim'; id: string; text: string; }
  export interface StructuredBlock { kind: 'structured'; id: string; prompt: string; }
  export interface GenerativeBlock { kind: 'generative'; id: string; prompt: string; }
  export type TemplateBlock = VerbatimBlock | StructuredBlock | GenerativeBlock;

  export const isVerbatim = (b: TemplateBlock): b is VerbatimBlock => b.kind === 'verbatim';
  export const isStructured = (b: TemplateBlock): b is StructuredBlock => b.kind === 'structured';
  export const isGenerative = (b: TemplateBlock): b is GenerativeBlock => b.kind === 'generative';

  export function assertNever(x: never): never {
    throw new Error(`unhandled block kind: ${JSON.stringify(x)}`);
  }
  ```
- [ ] Define interface contracts in `src/types.ts` so Lane A/B/C can parallelize:
  ```ts
  // Audit hook factory contract (Lane B implements)
  export interface AuditWriter { write(row: LlmCallRow): Promise<void>; }
  export interface LlmCallRow {
    schema_version: 1;
    id: string;
    ts: string;
    block_id: string;
    block_kind: 'structured' | 'generative';
    model: string;
    prompt: string;
    response: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
    finish_reason: string;
  }
  export interface CreateAuditHookOpts {
    writer: AuditWriter;
    now: () => Date;
    makeId: () => string;
    model: string;
    blockId: string;
    blockKind: 'structured' | 'generative';
  }

  // Replay loader contract (Lane C implements)
  export interface Fixture {
    prompt: string;
    response: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    finishReason: string;
  }
  export type ReplayFn = (blockId: string, prompt: string) => Promise<Fixture>;

  // Formatter signature (Lane A implements 3 variants)
  export interface FormatterCtx {
    replay: ReplayFn;
    audit: AuditWriter;
    now: () => Date;
    makeId: () => string;
  }
  ```
- [ ] `src/blocks.test.ts`: cover each `is*` predicate (3 happy + 3 wrong-type smoke tests).

**Verification:**
```bash
bun run typecheck
bun test src/blocks.test.ts
```

---

### Task 3 (Lane B): Audit hook — `src/audit.ts`

**Files:**
- `src/audit.ts` (create)
- `src/audit.test.ts` (create)

**Steps:**

- [ ] Implement `createAuditHook({writer, now, makeId, model, blockId, blockKind})` returning an `experimental_telemetry` settings object whose `onFinish` writes one `LlmCallRow` to `writer`.
- [ ] Defensive: `result.usage ?? { promptTokens: 0, completionTokens: 0 }` (mirror existing wrapper's audit.test.ts pattern).
- [ ] **CLAUDE.md hard rule:** `writer.write` throws must be **caught + logged + NOT propagated**. Use a `console.error('[audit:warn] ...')` matching DD2's locked copy:
  ```
  [audit:warn] failed to persist row for block '<block-id>': <error.message>. Demo continues; audit row dropped.
  ```
- [ ] Export `InMemoryAuditWriter` (for tests) and `FileAuditWriter` (writes pretty-printed JSON to `audit/<runId>/<callId>.json` per DD5).
- [ ] `FileAuditWriter` constructor takes `auditDir: string` (e.g., `audit/2026-01-01T00-00-00-000Z`). `mkdirSync({ recursive: true })` lazily on first write.
- [ ] Tests in `src/audit.test.ts`:
  - onFinish emits row with all 12 fields populated (use fake clock + fake makeId).
  - `usage` missing → tokens default to 0.
  - `writer.write` throws → row dropped, demo continues, stderr warn matches DD2 copy.
  - Fake clock + fake id → row is byte-identical across two invocations.

**Verification:**
```bash
bun run typecheck
bun test src/audit.test.ts
```

---

### Task 4 (Lane A): Verbatim formatter — `src/formatters/verbatim.ts`

**Files:**
- `src/formatters/verbatim.ts` (create)
- `src/formatters/verbatim.test.ts` (create)

**Steps:**

- [ ] Implement `verbatimFormatter(block: VerbatimBlock): string` — returns `block.text` directly. **No LLM call. No audit row.** That's the whole thesis for this kind.
- [ ] Tests:
  - Returns fixed text.
  - **Does NOT call replay or audit** (pass spies; assert `replay.calls === 0` and `audit.rows.length === 0`).

**Verification:**
```bash
bun test src/formatters/verbatim.test.ts
```

---

### Task 5 (Lane A): Structured formatter — `src/formatters/structured.ts`

**Files:**
- `src/formatters/structured.ts` (create)
- `src/formatters/structured.test.ts` (create)

**Steps:**

- [ ] Implement `structuredFormatter(block: StructuredBlock, ctx: FormatterCtx): Promise<string>`:
  1. Call `ctx.replay(block.id, block.prompt)` → `Fixture`.
  2. Parse `fixture.response` as JSON (clear error on malformed).
  3. Hand-rolled `assertGridShape(json)` (D-T2 — ~8 lines, throws "Block X: missing field Y").
  4. Render as ASCII table per DD1 spec (pipes only, no ANSI):
     ```
     | Domain        | Measure        | Value  |
     |---------------|----------------|--------|
     | Mobility      | Walk distance  | 50m    |
     ```
  5. **Emit one audit row** via `createAuditHook` factory using `block.id`, `fixture.model`, `block.prompt`, `fixture.response`, `fixture.tokensIn`, `fixture.tokensOut`, `'stop'` finish reason.
- [ ] Tests:
  - Valid stub JSON → expected table string.
  - Malformed JSON → clear throw with block id in message.
  - Wrong shape → hand-rolled validator throws with missing field name.
  - One audit row emitted per call.

**Verification:**
```bash
bun test src/formatters/structured.test.ts
```

---

### Task 6 (Lane A): Generative formatter — `src/formatters/generative.ts`

**Files:**
- `src/formatters/generative.ts` (create)
- `src/formatters/generative.test.ts` (create)

**Steps:**

- [ ] Implement `generativeFormatter(block: GenerativeBlock, ctx: FormatterCtx): Promise<string>`:
  1. Call `ctx.replay(block.id, block.prompt)` → `Fixture`.
  2. Take `fixture.response` as plain text (no JSON parse).
  3. Trim, wrap at 80 cols per DD6 (use a small wrap helper — accepts empty string).
  4. Emit one audit row, same shape as structured (model from fixture, etc).
- [ ] Tests:
  - Valid stub text → wrapped to 80 cols.
  - Empty response → returns empty string, audit row still emits (with empty `response`).
  - One audit row emitted per call.

**Verification:**
```bash
bun test src/formatters/generative.test.ts
```

---

### Task 7 (depends on 4/5/6): Router — `src/router.ts`

**Files:**
- `src/router.ts` (create)
- `src/router.test.ts` (create)

**Steps:**

- [ ] Implement `route(blocks: TemplateBlock[], ctx: FormatterCtx): Promise<string[]>`:
  ```ts
  for (const block of blocks) {
    switch (block.kind) {
      case 'verbatim': out.push(verbatimFormatter(block)); break;
      case 'structured': out.push(await structuredFormatter(block, ctx)); break;
      case 'generative': out.push(await generativeFormatter(block, ctx)); break;
      default: assertNever(block);
    }
  }
  ```
- [ ] **The switch is the thesis** — do not refactor to a Map lookup or Visitor (D-A3). Keep it literal.
- [ ] Tests:
  - Mixed blocks → formatters called in declared order with correct args.
  - Empty array → returns `[]`, no calls.
  - Formatter throws → propagates (intended — see failure-modes table).
  - **T1 cast-cheat regression:** `route([{ kind: 'unknown' as any } as any], ctx)` throws with `"unhandled block kind"` in message.

**Verification:**
```bash
bun test src/router.test.ts
```

---

### Task 8 (Lane C): Replay loader + fixture validator — `src/replay.ts`

**Files:**
- `src/replay.ts` (create)
- `src/replay.test.ts` (create)

**Steps:**

- [ ] Implement `createReplayLoader(fixturesDir: string): ReplayFn`:
  1. `readFileSync` `${fixturesDir}/${blockId}.json` → throw DD2 message if ENOENT.
  2. `JSON.parse` → throw DD2 malformed-JSON message on syntax error.
  3. Hand-rolled `assertFixtureShape(obj)` (D-T2, ~8 lines, checks `{prompt, response, model, tokensIn, tokensOut, finishReason}`).
  4. Return `Fixture`.
- [ ] Failure messages **must match DD2 copy verbatim** (named-artifact, suggested-fix). Tests pin the strings.
- [ ] Tests:
  - Fixture present → returns canned response.
  - Missing file → throws with DD2 missing-fixture message.
  - Malformed JSON → throws with DD2 malformed-JSON message.
  - Schema mismatch → throws with DD2 missing-field message naming the field.

**Verification:**
```bash
bun test src/replay.test.ts
```

---

### Task 9 (after 4/5/6/8): Transcripts + fixtures content

**Files:**
- `transcripts/canned.json` (create)
- `fixtures/llm-responses/functional-status-grid.json` (create)
- `fixtures/llm-responses/clinical-impression.json` (create)
- `templates/acc-srna-skeleton.json` (create — the 3-block template referenced in DD1 banner)

**Steps:**

- [ ] `transcripts/canned.json`: realistic-shaped clinical transcript (synthetic, no real PII). Used as context for the prompts. ~30 lines of plausible-sounding session content.
- [ ] `templates/acc-srna-skeleton.json`: 3 blocks per DD1 spec:
  ```json
  [
    { "kind": "verbatim", "id": "introduction", "text": "This report has been generated under the requirements of ACC Section 32 IOA assessment standards. All findings are based on the consultation transcript dated 2026-01-01." },
    { "kind": "structured", "id": "functional-status-grid", "prompt": "Given the transcript below, extract the functional status grid as JSON with shape {mobility:{walk_distance_m:number}, pain:{vas:number}}. Transcript: <transcript>" },
    { "kind": "generative", "id": "clinical-impression", "prompt": "Write a 2-3 sentence clinical impression paragraph from the transcript below. Transcript: <transcript>" }
  ]
  ```
- [ ] `fixtures/llm-responses/functional-status-grid.json`:
  ```json
  {
    "prompt": "Given the transcript below, extract the functional status grid as JSON with shape {mobility:{walk_distance_m:number}, pain:{vas:number}}. Transcript: <transcript>",
    "response": "{\"mobility\":{\"walk_distance_m\":50},\"pain\":{\"vas\":7}}",
    "model": "openai/gpt-4o",
    "tokensIn": 142,
    "tokensOut": 88,
    "finishReason": "stop"
  }
  ```
- [ ] `fixtures/llm-responses/clinical-impression.json`: same shape, plain-text response.
- [ ] **No real patient data anywhere.** Synthetic only. Names should be obviously synthetic (e.g., "Jane Citizen" or numeric IDs).

**Verification:**
```bash
node -e "JSON.parse(require('fs').readFileSync('transcripts/canned.json'))"
node -e "JSON.parse(require('fs').readFileSync('fixtures/llm-responses/functional-status-grid.json'))"
node -e "JSON.parse(require('fs').readFileSync('fixtures/llm-responses/clinical-impression.json'))"
node -e "JSON.parse(require('fs').readFileSync('templates/acc-srna-skeleton.json'))"
```

---

### Task 10 (after 7/8/9): Demo entry — `src/demo.ts` + e2e test

**Files:**
- `src/demo.ts` (create)
- `tests/e2e/demo.test.ts` (create)

**Steps:**

- [ ] Implement `src/demo.ts`:
  1. Load template `templates/acc-srna-skeleton.json`.
  2. **Inject fixed clock** (`() => new Date('2026-01-01T00:00:00.000Z')`) and **monotonic id counter** (`call-001`, `call-002`, ...). These are the A2 injection seams.
  3. Compute `runId` from fixed clock: `2026-01-01T00-00-00-000Z`.
  4. **`mkdirSync('audit', { recursive: true })`**. If the path exists but is a file (not dir), throw with DD2 copy: `Error: cannot create audit directory — 'audit/' is a file. Remove or rename it and re-run.`
  5. `mkdirSync('audit/<runId>', { recursive: true })`.
  6. Wire `FormatterCtx`: `replay = createReplayLoader('fixtures/llm-responses')`, `audit = new FileAuditWriter('audit/<runId>')`, fixed `now` + `makeId`.
  7. Call `route(blocks, ctx)` → array of rendered strings.
  8. Print stdout exactly per **DD1 spec** (banner, per-block header with 10-char left-padded kind, body, summary line). Use `console.log`.
  9. Exit 0 on success.
- [ ] `tests/e2e/demo.test.ts`:
  - `bun run src/demo.ts` → exit 0.
  - stdout matches DD1 shape (assert per-line, ignoring trailing whitespace).
  - `audit/<runId>/` contains exactly 2 JSON files (verbatim makes no call).
  - Each JSON file matches DD4 shape with `schema_version: 1`.
  - **Re-run produces byte-identical stdout** (modulo runId being a fixed string, it IS identical).
  - **Audit-dir collision E2E:** create a file at `audit/` (instead of dir), run demo, assert DD2 error message + non-zero exit.

**Verification:**
```bash
bun run demo
ls audit/2026-01-01T00-00-00-000Z/
bun test tests/e2e/demo.test.ts
```

---

### Task 11 (after 10): Golden-file regression — `bun run check`

**Files:**
- `scripts/check.ts` (create)
- `golden/audit/call-001.json` (create — commit the canonical first-LLM-call row)
- `golden/audit/call-002.json` (create — commit the canonical second-LLM-call row)
- `golden/audit/.gitkeep` (create if needed)

**Steps:**

- [ ] Run `bun run demo` once to populate `audit/2026-01-01T00-00-00-000Z/`. Copy the two JSON files into `golden/audit/` (strip the runId dir per DD5).
- [ ] `scripts/check.ts` (`bun run check` impl):
  1. Run `bun run demo` (spawn).
  2. Locate the produced `audit/<runId>/` dir (there's only one when using fixed clock).
  3. For each `call-NNN.json` file: read both `audit/<runId>/call-NNN.json` and `golden/audit/call-NNN.json`, do a `===` byte compare on the JSON strings (or deep-equal on parsed objects + re-stringify with the same indent).
  4. Print `OK: <N> calls match golden` on success, or `DIFF in <file>: <unified diff>` on failure.
  5. `--update` flag: copy from `audit/<runId>/` into `golden/audit/`, log what was updated.
  6. Exit 0 on match, 1 on diff.
- [ ] Add `scripts/check.test.ts` covering: golden match, golden mismatch reports diff, `--update` overwrites golden.

**Verification:**
```bash
bun run demo
bun run check        # → OK: 2 calls match golden, exit 0
bun run check --update  # idempotent re-write
bun test scripts/check.test.ts
```

---

### Task 12 (final): README + CI + GitHub repo + branch protection

**Files:**
- `README.md` (overwrite with locked DD3 copy)
- `.github/workflows/ci.yml` (create)
- `.github/CODEOWNERS` (create — optional, `* @joshwilks111-max`)

**Steps:**

- [ ] **README.md**: copy DD3 locked draft (source plan lines 341-404) verbatim. Badge URL is `https://github.com/joshwilks111-max/clinical-reports-wrapper-poc/actions/workflows/ci.yml/badge.svg` — fill after first CI run.
- [ ] **`.github/workflows/ci.yml`** per D-T3:
  ```yaml
  name: CI
  on:
    push: { branches: [main] }
    pull_request: { branches: [main] }
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: oven-sh/setup-bun@v2
        - run: bun install --frozen-lockfile
        - run: bun run typecheck
        - run: bun test --coverage --coverage-reporter=text
        - run: bun run check
  ```
  - Coverage gate: bun's `--coverage` does not natively enforce a threshold. **Use a small post-test gate script** (`scripts/coverage-gate.ts`) that parses `coverage/lcov.info` or `bun test --coverage --coverage-reporter=json` output, asserts line coverage ≥ 0.9, exits 1 otherwise. Add as final CI step.
- [ ] Run `gh repo create joshwilks111-max/clinical-reports-wrapper-poc --public --source=. --description "Block-per-block routing PoC for clinical reports" --push`. (Confirm with Josh before running — already pre-approved at dispatch time.)
- [ ] After first CI run completes green: enable branch protection on `main`:
  ```bash
  gh api -X PUT repos/joshwilks111-max/clinical-reports-wrapper-poc/branches/main/protection \
    -F required_status_checks.strict=true \
    -F 'required_status_checks.contexts[]=test' \
    -F enforce_admins=false \
    -F required_pull_request_reviews.required_approving_review_count=0 \
    -F restrictions=null
  ```
- [ ] Update README badge URL once the actual CI run URL is known. Commit `chore: update CI badge`.

**Verification:**
```bash
gh repo view joshwilks111-max/clinical-reports-wrapper-poc
gh run list --limit 1   # CI run, status: completed, conclusion: success
gh api repos/joshwilks111-max/clinical-reports-wrapper-poc/branches/main/protection | jq .required_status_checks.contexts
```

---

## Dependency graph

```
Task 1 (scaffold) ──┐
                    ├── Task 2 (types) ──┬── Task 3 (Lane B: audit)   ──┐
                    │                    ├── Task 4 (Lane A: verbatim) ─┤
                    │                    ├── Task 5 (Lane A: structured)─┤
                    │                    ├── Task 6 (Lane A: generative)─┤
                    │                    └── Task 8 (Lane C: replay) ───┤
                    │                                                    │
                    │                                       Task 9 (fixtures content) ──┐
                    │                                                                   │
                    │                              Task 7 (router, needs 4/5/6) ────────┤
                    │                                                                   │
                    │                                       Task 10 (demo) ─────────────┤
                    │                                                                   │
                    │                                       Task 11 (check) ────────────┤
                    │                                                                   │
                    │                                       Task 12 (README+CI+GH) ─────┘
```

- **Round 0 (sequential):** Task 1 → Task 2
- **Round 1 (parallel):** Tasks 3, 4, 5, 6, 8, 9 — six independent agents
- **Round 2 (sequential):** Task 7 (router) → Task 10 (demo, also needs 9)
- **Round 3 (sequential):** Task 11 (golden) → Task 12 (README + CI + GH)

## CLAUDE.md hard rules (must hold throughout)

1. **No real patient data.** Synthetic only. Names like "Jane Citizen" or numeric IDs.
2. **Single audit emission point** — `createAuditHook.onFinish`. No other code path emits `LlmCallRow`.
3. **Audit failure must NOT propagate** — `writer.write` throws are caught, warned (DD2 copy), demo exits 0.
4. **No marketing/AI-slop prose in README** — DD3 copy is locked.

## Coverage target

- Bun `--coverage`, line coverage ≥ 0.9.
- CI hard-fails below.
- 32 paths covered per source plan's coverage diagram (lines 207-254).

## Failure-message copy (DD2 — locked verbatim)

| Code path | Message |
|---|---|
| audit-dir collision | `Error: cannot create audit directory — 'audit/' is a file. Remove or rename it and re-run.` |
| fixture missing | `Error: fixture for block '<block-id>' not found at fixtures/llm-responses/<block-id>.json. Re-clone the repo or run 'bun run check --update' to regenerate.` |
| fixture malformed | `Error: fixture at fixtures/llm-responses/<block-id>.json is not valid JSON. Restore from git: 'git checkout fixtures/llm-responses/<block-id>.json'.` |
| fixture missing field | `Error: fixture '<block-id>' is missing required field '<field>'. Expected shape: { prompt, response, model, tokensIn, tokensOut, finishReason }.` |
| audit writer throws | `[audit:warn] failed to persist row for block '<block-id>': <error.message>. Demo continues; audit row dropped.` |
