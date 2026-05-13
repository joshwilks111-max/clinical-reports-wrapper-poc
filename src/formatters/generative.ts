import type { GenerativeBlock } from "../blocks.ts";
import type { FormatterCtx, LlmCallRow } from "../types.ts";
import { safeWrite } from "../audit.ts";

/**
 * Generative formatter — wraps a plain-text LLM response at 80 columns.
 *
 * No JSON parse. No schema validation. The model owns the prose; we own
 * the line-length contract (DD6) and the audit row (DD4).
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
    latency_ms: 0,
    finish_reason: fixture.finishReason,
  };

  await safeWrite(ctx.audit, row);

  return wrapped;
}

/**
 * Wraps text at 80 columns. Preserves paragraph breaks (existing newlines).
 *
 * Rules:
 * - Split on existing newlines first.
 * - Lines already ≤ 80 chars are kept as-is.
 * - Longer lines are word-wrapped greedily: break at the last space at or
 *   before column 80. Never break inside a word.
 * - A single token longer than 80 chars is placed on its own line unchanged.
 * - Empty input → empty string.
 */
function wrapAt80(text: string): string {
  if (text === "") return "";

  const paragraphs = text.split("\n");
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= 80) {
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
      } else if (currentLine.length + 1 + word.length <= 80) {
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
