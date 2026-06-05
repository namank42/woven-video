"use server";

import { headers } from "next/headers";

import { validateContact } from "@/lib/contact/validation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ContactState =
  | { status: "idle" }
  | {
      status: "error";
      errors: Record<string, string[]>;
      values: { name: string; email: string; message: string };
    }
  | { status: "success"; email: string };

// Best-effort, per-instance throttle. Serverless instances are ephemeral, so this
// is a soft secondary defense — the honeypot is primary, and Cloudflare Turnstile
// is the escalation path if spam appears.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitContact(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  // Honeypot: bots fill hidden fields. Look like success, write nothing.
  if (field(formData, "company") !== "") {
    return { status: "success", email: field(formData, "email") };
  }

  const values = {
    name: field(formData, "name"),
    email: field(formData, "email"),
    message: field(formData, "message"),
  };

  const result = validateContact(values);
  if (!result.ok) {
    return { status: "error", errors: result.errors, values };
  }

  const headerList = await headers();
  const ip =
    (headerList.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return {
      status: "error",
      errors: { _form: ["Too many messages. Please try again in a few minutes."] },
      values,
    };
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("feedback").insert({
    message: result.data.message,
    name: result.data.name,
    email: result.data.email,
    source: "web",
  });

  if (error) {
    console.error("contact submit failed:", error.message);
    return {
      status: "error",
      errors: { _form: ["Something went wrong. Please try again."] },
      values,
    };
  }

  return { status: "success", email: result.data.email };
}
