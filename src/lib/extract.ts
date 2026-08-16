import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

export const BLOCK_TYPES = [
  "hero",
  "subhead",
  "benefit",
  "proof",
  "objection",
  "cta",
  "guarantee",
  "offer",
  "faq",
  "other",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export interface CopyBlock {
  block_type: BlockType;
  content: string;
  position: number;
}

export interface Scores {
  claim_specificity: number;
  proof_density: number;
  objection_handling: number;
  offer_clarity: number;
  voice_distinctiveness: number;
  structural_craft: number;
}

export interface Extraction {
  blocks: CopyBlock[];
  scores: Scores;
  why_good: string;
  tags: string[];
}

/** Spec §6.4, verbatim. */
const SYSTEM_PROMPT = `You are analyzing a landing page for a copywriting swipe file.

Return ONLY valid JSON, no preamble, no markdown fences:
{
  "blocks": [
    {"block_type": "hero|subhead|benefit|proof|objection|cta|guarantee|offer|faq|other",
     "content": "verbatim copy",
     "position": 0}
  ],
  "scores": {
    "claim_specificity": 1-5,
    "proof_density": 1-5,
    "objection_handling": 1-5,
    "offer_clarity": 1-5,
    "voice_distinctiveness": 1-5,
    "structural_craft": 1-5
  },
  "why_good": "one sentence, max 25 words, naming the single most transferable technique",
  "tags": ["2-4 lowercase-hyphenated system tags"]
}

Scoring anchors:

claim_specificity — 1: vague benefit language ("feel your best").
  3: named benefit, no mechanism. 5: mechanism + number + timeframe.

proof_density — ratio of substantiated claims to total claims.
  1: nothing behind the claims. 3: star rating and testimonials.
  5: layered clinical, social, expert and visual proof, each placed
     next to the claim it supports.

objection_handling — 1: no objections addressed. 3: an FAQ block at the bottom.
  5: objections handled inline at the moment they arise, in customer language.

offer_clarity — can the offer be stated in one sentence after five seconds?
  5: unmissable offer, explicit guarantee, friction named and neutralized.

voice_distinctiveness — swap the logo for a competitor's. Does the copy still work?
  If yes, score 1. 5: could not have been written by anyone else.

structural_craft — message hierarchy, whether the hero does its job,
  whether each section earns the scroll.

Score what is on the page. Do not infer intent or give credit for
what the page seems to be attempting.`;

const SCORE_FIELD = { type: "integer", minimum: 1, maximum: 5 } as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          block_type: { type: "string", enum: [...BLOCK_TYPES] },
          content: { type: "string" },
          position: { type: "integer" },
        },
        required: ["block_type", "content", "position"],
        additionalProperties: false,
      },
    },
    scores: {
      type: "object",
      properties: {
        claim_specificity: SCORE_FIELD,
        proof_density: SCORE_FIELD,
        objection_handling: SCORE_FIELD,
        offer_clarity: SCORE_FIELD,
        voice_distinctiveness: SCORE_FIELD,
        structural_craft: SCORE_FIELD,
      },
      required: [
        "claim_specificity",
        "proof_density",
        "objection_handling",
        "offer_clarity",
        "voice_distinctiveness",
        "structural_craft",
      ],
      additionalProperties: false,
    },
    why_good: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["blocks", "scores", "why_good", "tags"],
  additionalProperties: false,
} as const;

let anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: env.anthropicKey });
  return anthropic;
}

/** Model output can drift on the edges; clamp before it reaches the database. */
function clampScore(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, n));
}

function toSlug(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * One Anthropic call per page: segment the copy into blocks, score six
 * dimensions, and name the single most transferable technique.
 */
export async function extractAndScore(input: {
  url: string;
  title: string | null;
  text: string;
}): Promise<Extraction> {
  // Guard against a pathological page blowing the context window.
  const body = input.text.slice(0, 120_000);

  const response = await client().messages.create({
    model: env.anthropicModel,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `URL: ${input.url}\nTitle: ${input.title ?? "(none)"}\n\n--- PAGE COPY ---\n${body}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Anthropic declined to analyze this page (stop_reason: refusal)");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Extraction hit max_tokens — the page is too long to analyze in one pass");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic returned no text block");
  }

  const parsed = parseExtraction(textBlock.text);

  return {
    blocks: parsed.blocks
      .filter((b) => b.content && b.content.trim())
      .map((b, i) => ({
        block_type: (BLOCK_TYPES as readonly string[]).includes(b.block_type)
          ? b.block_type
          : "other",
        content: b.content.trim(),
        position: Number.isFinite(b.position) ? b.position : i,
      })),
    scores: {
      claim_specificity: clampScore(parsed.scores?.claim_specificity),
      proof_density: clampScore(parsed.scores?.proof_density),
      objection_handling: clampScore(parsed.scores?.objection_handling),
      offer_clarity: clampScore(parsed.scores?.offer_clarity),
      voice_distinctiveness: clampScore(parsed.scores?.voice_distinctiveness),
      structural_craft: clampScore(parsed.scores?.structural_craft),
    },
    why_good: (parsed.why_good ?? "").trim(),
    tags: Array.from(new Set((parsed.tags ?? []).map(toSlug).filter(Boolean))).slice(0, 4),
  };
}

function parseExtraction(raw: string): Extraction {
  try {
    return JSON.parse(raw) as Extraction;
  } catch {
    // Structured outputs should make this unreachable, but a stray fence or
    // preamble shouldn't cost a scrape.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]) as Extraction;
    const braced = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return JSON.parse(braced) as Extraction;
  }
}

/**
 * Composite is computed server-side, never by the model (spec §6.4):
 *   (voice*2 + claim*1.5 + proof*1.5 + objection + offer + structure) / 8
 */
export function compositeScore(s: Scores): number {
  const raw =
    (s.voice_distinctiveness * 2 +
      s.claim_specificity * 1.5 +
      s.proof_density * 1.5 +
      s.objection_handling +
      s.offer_clarity +
      s.structural_craft) /
    8;
  return Math.round(raw * 100) / 100;
}
