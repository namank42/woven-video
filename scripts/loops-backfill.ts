#!/usr/bin/env -S npx tsx
// One-shot backfill: copy every auth.users row into Loops as a contact.
// Does NOT fire a signup event — backfilled users should not receive the welcome loop.
// Idempotent: uses PUT /contacts/update which upserts by email.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LOOPS_API_KEY=... pnpm tsx scripts/loops-backfill.ts
//   add --dry to preview without writing.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOOPS_KEY = process.env.LOOPS_API_KEY;
const EDITOR_LIST_ID = process.env.LOOPS_EDITOR_LIST_ID;
const DRY = process.argv.includes("--dry");

if (!SUPABASE_URL || !SERVICE_ROLE || !LOOPS_KEY || !EDITOR_LIST_ID) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOOPS_API_KEY, or LOOPS_EDITOR_LIST_ID");
  process.exit(1);
}
const EDITOR: string = EDITOR_LIST_ID;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Row = {
  id: string;
  email: string | null;
  created_at: string;
  raw_app_meta_data: { provider?: string } | null;
};

async function listUsers(): Promise<Row[]> {
  const out: Row[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      out.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        raw_app_meta_data: (u.app_metadata as { provider?: string }) ?? null,
      });
    }
    if (data.users.length < 1000) break;
    page += 1;
  }
  return out;
}

async function upsertLoops(row: Row): Promise<"ok" | "skip" | "err"> {
  if (!row.email) return "skip";
  const body = {
    email: row.email,
    userId: row.id,
    source: "backfill",
    userGroup: row.raw_app_meta_data?.provider ?? "unknown",
    createdAt: row.created_at,
    mailingLists: { [EDITOR]: true },
  };
  if (DRY) {
    console.log("[dry]", JSON.stringify(body));
    return "ok";
  }
  const res = await fetch("https://app.loops.so/api/v1/contacts/update", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOOPS_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`fail ${row.email} ${res.status} ${await res.text()}`);
    return "err";
  }
  return "ok";
}

async function main() {
  const users = await listUsers();
  console.log(`fetched ${users.length} users (dry=${DRY})`);

  let ok = 0, skip = 0, err = 0;
  for (const u of users) {
    const r = await upsertLoops(u);
    if (r === "ok") ok++; else if (r === "skip") skip++; else err++;
    if ((ok + skip + err) % 50 === 0) console.log(`progress ok=${ok} skip=${skip} err=${err}`);
  }
  console.log(`done ok=${ok} skip=${skip} err=${err}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
