# clinical-reports-wrapper-poc

[![CI](https://github.com/joshwilks111-max/clinical-reports-wrapper-poc/actions/workflows/ci.yml/badge.svg)](https://github.com/joshwilks111-max/clinical-reports-wrapper-poc/actions/workflows/ci.yml)

> **Block-per-block routing.** A clinical report is a sequence of blocks.
> Each block has a type. The agent routes each block to the correct
> deterministic formatter — it does not generate format output itself.
> Formatting is a tool the agent calls, not something the agent does.

## Run it

    bun install
    bun run demo

That's the whole demo. No API key. No setup. <60 seconds cold-clone to output.

## What this proves

Three things, by demonstration not assertion:

1. **The agent's job is routing, not generation.** `src/router.ts` is a
   `switch (block.kind)`. The switch is the thesis: dispatch, not derive.
2. **Formatting is deterministic tool code.** `verbatim` returns fixed text.
   `structured` parses LLM JSON into a known table. `generative` wraps a
   LLM string. Three formatters, one signature, no improvisation.
3. **Every LLM call leaves a row.** The audit hook fires on every
   structured + generative call. Open `audit/<runId>/<callId>.json`
   to see prompt, response, model, tokens — pretty-printed.

## Architecture

    transcripts/canned.json
        ↓
    src/router.ts (switch on block.kind)
        ↓
    ┌─────────────┬───────────────┬───────────────┐
    │  verbatim   │  structured   │  generative   │  ← src/formatters/
    │  (no LLM)   │  (LLM + JSON) │  (LLM + text) │
    └─────────────┴───────────────┴───────────────┘
        ↓                ↓                ↓
       stdout       stdout + audit   stdout + audit

## Why canned responses?

This is a proof of an architectural thesis, not a product. Canned LLM
responses make the demo:

- **Zero-friction.** No API key, no rate limits, no flake.
- **Deterministic.** Two runs produce byte-identical output (modulo
  run-id). The same property a real CI gate needs — see `bun run check`.
- **Scope-disciplined.** A live-API mode is one flag away (`--live`,
  v1.5) but is not the point. The architecture is fully visible in
  canned mode.

The audit row still has real shape: prompt, model, tokens, finish reason.
Nothing is faked — only the response body is replayed from
`fixtures/llm-responses/<block-id>.json`.

## Tests

    bun test
    bun run check    # golden-file regression gate

Line coverage gate: ≥90%, CI hard-fails below.
