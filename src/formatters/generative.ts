import type { GenerativeBlock } from "../blocks.ts";
import type { FormatterCtx, LlmCallRow } from "../types.ts";
import { safeWrite } from "../audit.ts";

/** Column width for word-wrap. Renders cleanly in Windows cmd, pipes, log capture. */
const WRAP_COL = 80;

/**
 * Generative formatter — wraps a plain-text LLM response at WRAP_COL columns.
 *
 * No JSON parse. No schema validation. The model owns the prose; we own
 * the line-length contract and the audit row.
 */
export async function generativeFormatter(
  block: GenerativeBlock,
  ctx: FormatterCtx,
): Promise<string> {
  const fixture = await ctx.replay(block.id, block.prompt);

  const wrapped = wrapAt80(fixture.response.trim());

  const row: LlmCallRow = {
    schema_version: 1,
    id: ctx.makeId(),
    ts: ctx.now().toISOString(),
    block_id: block.id,
    block_kind: "generative",
    model: fixture.model,
    prompt: block.prompt,
    response: fixture.response,
    tokens_in: fixture.tokensIn,
    tokens_out: fixture.tokensOut,
    // TODO(v1.5): wire latency_ms — needs wall-clock measurement in live mode
    latency_ms: 0,
    finish_reason: fixture.finishReason,
  };

  await safeWrite(ctx.audit, row);

  return wrapped;
}

/**
 * Wraps text at WRAP_COL columns. Preserves paragraph breaks (existing newlines).
 *
 * Rules:
 * - Split on existing newlines first.
 * - Lines already ≤ WRAP_COL chars are kept as-is.
 * - Longer lines are word-wrapped greedily: break at the last space at or
 *   before the column boundary. Never break inside a word.
 * - A single token longer than WRAP_COL chars is placed on its own line unchanged.
 * - Empty input → empty string.
 */
function wrapAt80(text: string): string {
  if (text === "") return "";

  const paragraphs = text.split("\n");
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= WRAP_COL) {
      result.push(paragraph);
      continue;
    }

    // Word-wrap this paragraph.
    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      if (currentLine === "") {
        // First word on a new line — place it regardless of length.
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= WRAP_COL) {
        currentLine += " " + word;
      } else {
        // Current line is full; flush it and start a new line.
        result.push(currentLine);
        currentLine = word;
      }
    }

    // Flush the last line.
    if (currentLine !== "") {
      result.push(currentLine);
    }
  }

  return result.join("\n");
}
