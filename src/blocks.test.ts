import { describe, expect, test } from "bun:test";
import {
  assertNever,
  isGenerative,
  isStructured,
  isVerbatim,
  type GenerativeBlock,
  type StructuredBlock,
  type TemplateBlock,
  type VerbatimBlock,
} from "./blocks.ts";

const verbatim: VerbatimBlock = {
  kind: "verbatim",
  id: "intro",
  text: "fixed",
};
const structured: StructuredBlock = {
  kind: "structured",
  id: "grid",
  prompt: "p",
};
const generative: GenerativeBlock = {
  kind: "generative",
  id: "impression",
  prompt: "p",
};

describe("block discriminators", () => {
  test("isVerbatim narrows correctly", () => {
    expect(isVerbatim(verbatim)).toBe(true);
    expect(isVerbatim(structured)).toBe(false);
    expect(isVerbatim(generative)).toBe(false);
  });

  test("isStructured narrows correctly", () => {
    expect(isStructured(structured)).toBe(true);
    expect(isStructured(verbatim)).toBe(false);
    expect(isStructured(generative)).toBe(false);
  });

  test("isGenerative narrows correctly", () => {
    expect(isGenerative(generative)).toBe(true);
    expect(isGenerative(verbatim)).toBe(false);
    expect(isGenerative(structured)).toBe(false);
  });
});

describe("assertNever", () => {
  test("throws with the block kind included for cast-cheat smoke", () => {
    const bad = { kind: "unknown", id: "x" } as unknown as TemplateBlock;
    expect(() => {
      switch (bad.kind) {
        case "verbatim":
        case "structured":
        case "generative":
          return;
        default:
          assertNever(bad as never);
      }
    }).toThrow(/unhandled block kind/);
  });
});
