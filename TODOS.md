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
