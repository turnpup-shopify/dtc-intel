#!/usr/bin/env node
/**
 * Load data/seed-brands-candidates.csv into `companies`.
 *
 * Rows with a populated meta_page_id are usable immediately; the rest are inert
 * until the human fills them in on /companies.
 *
 * Usage:  npm run seed        (reads .env.local)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, "..", "data", "seed-brands-candidates.csv");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. in .env.local).");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** Minimal RFC-4180 parser — the notes column contains commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const header = rows[0].map((h) => h.trim());
const records = rows.slice(1).map((cells) =>
  Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]))
);

const companies = records
  .filter((r) => r.name)
  .map((r) => ({
    name: r.name,
    domain: r.domain || null,
    meta_page_id: r.meta_page_id || null,
    tier: r.tier || null,
    category: r.category || null,
    active: true,
  }));

console.log(`Seeding ${companies.length} companies…`);

let inserted = 0;
let skipped = 0;

for (const company of companies) {
  // Upsert by domain when we have one, otherwise match on name so the
  // advertorial rows (which have no domain) stay idempotent too.
  const { data: existing } = company.domain
    ? await db.from("companies").select("id").eq("domain", company.domain).maybeSingle()
    : await db.from("companies").select("id").eq("name", company.name).maybeSingle();

  if (existing) {
    const { error } = await db
      .from("companies")
      .update({
        meta_page_id: company.meta_page_id ?? undefined,
        tier: company.tier,
        category: company.category,
      })
      .eq("id", existing.id);
    if (error) console.error(`  ! ${company.name}: ${error.message}`);
    skipped++;
    continue;
  }

  const { error } = await db.from("companies").insert(company);
  if (error) {
    console.error(`  ! ${company.name}: ${error.message}`);
    continue;
  }
  inserted++;
}

const withPageId = companies.filter((c) => c.meta_page_id).length;
console.log(`Done. ${inserted} inserted, ${skipped} already present.`);
console.log(`${withPageId} have a verified meta_page_id; fill in the rest on /companies.`);
