/**
 * The category taxonomy — six buckets, matching the check constraint on
 * `companies.category` (see supabase/migrations/0003_rework_categories.sql).
 *
 * Deliberately coarse. A category earns its place by answering "show me proof
 * blocks from supplements brands" or "show me voice from an adjacent category";
 * a bucket of one answers neither, which is what the seeded taxonomy was.
 */
export const CATEGORIES = [
  "supplements",
  "food/bev",
  "personal care",
  "fashion",
  "health care",
  "home",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export const TIERS = ["direct", "adjacent", "copycraft", "advertorial"] as const;
