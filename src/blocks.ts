/**
 * Tagged-union block model.
 *
 * The router (src/router.ts) switches on `kind` and dispatches to a
 * deterministic formatter. Adding a new kind requires:
 *   1. A new interface here with a unique `kind` literal.
 *   2. A new branch in `route()` — `assertNever` catches missing cases.
 *
 * The switch IS the thesis. Don't refactor it to a Map or Visitor.
 */

export interface VerbatimBlock {
  kind: "verbatim";
  id: string;
  text: string;
}

export interface StructuredBlock {
  kind: "structured";
  id: string;
  prompt: string;
}

export interface GenerativeBlock {
  kind: "generative";
  id: string;
  prompt: string;
}

export type TemplateBlock = VerbatimBlock | StructuredBlock | GenerativeBlock;

export const isVerbatim = (b: TemplateBlock): b is VerbatimBlock =>
  b.kind === "verbatim";
export const isStructured = (b: TemplateBlock): b is StructuredBlock =>
  b.kind === "structured";
export const isGenerative = (b: TemplateBlock): b is GenerativeBlock =>
  b.kind === "generative";

export function assertNever(x: never): never {
  throw new Error(`unhandled block kind: ${JSON.stringify(x)}`);
}
