import { assertNever, type TemplateBlock } from "./blocks.ts";
import type { FormatterCtx } from "./types.ts";
import { verbatimFormatter } from "./formatters/verbatim.ts";
import { structuredFormatter } from "./formatters/structured.ts";
import { generativeFormatter } from "./formatters/generative.ts";

export async function route(
  blocks: TemplateBlock[],
  ctx: FormatterCtx,
): Promise<string[]> {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "verbatim":
        out.push(verbatimFormatter(block));
        break;
      case "structured":
        out.push(await structuredFormatter(block, ctx));
        break;
      case "generative":
        out.push(await generativeFormatter(block, ctx));
        break;
      default:
        assertNever(block);
    }
  }
  return out;
}
