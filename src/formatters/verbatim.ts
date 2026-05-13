import type { VerbatimBlock } from "../blocks.ts";

/**
 * Verbatim formatter — pure function, no LLM call, no audit row.
 *
 * The simplicity is the message: verbatim blocks are pre-authored text that
 * must reach the output byte-for-byte. No ctx needed, no ctx accepted.
 */
export function verbatimFormatter(block: VerbatimBlock): string {
  return block.text;
}
