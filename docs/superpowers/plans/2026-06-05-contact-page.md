# Contact Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/contact` page whose form submissions flow into the existing `feedback` → `notify_slack_on_feedback()` → Slack pipeline (currently Mac-app only), reachable from the footer, landing page, and account page.

**Architecture:** A `/contact` Server Component renders a client `ContactForm` driven by a Next 16 Server Action. The action validates server-side (honeypot + hand-rolled validation + best-effort throttle) and inserts via the service-role client with `source='web'` and `user_id` null; the existing DB trigger posts to Slack. A migration adds `name`/`email`/`source` columns and surgically updates the Slack trigger so web submissions render correctly and the "Reply via email" button works.

**Tech Stack:** Next.js 16.2.3 (App Router, Server Actions), React 19.2.4 (`useActionState`), Supabase (Postgres + service-role client + Vault), shadcn `base-nova` on `@base-ui/react`, Tailwind v4.

**Docs digest:** `docs/superpowers/research/2026-06-05-nextjs-forms-contact.md` (Next 16 Server Action form pattern + shadcn `base-nova` Field/Textarea). Spec: `docs/superpowers/specs/2026-06-05-contact-page-design.md`.

**Testing approach:** This repo has no test runner (only `eslint`; existing API routes validate inline without tests). Following the codebase convention, verification is `pnpm build` (Next build = typecheck + compile) + `pnpm lint` + explicit manual checks per task. The validation logic is extracted into a pure function (`lib/contact/validation.ts`) so it can be unit-tested if a runner is added later. Slack delivery is only testable where the Vault secret is seeded (preview/prod) — the trigger no-ops locally by design.

**Branch:** `contact-page` (already checked out).

---

## File Structure

**Create:**
- `supabase/migrations/20260605120000_add_contact_fields_to_feedback.sql` — columns + trigger update
- `lib/contact/validation.ts` — pure input validation (no deps)
- `app/contact/actions.ts` — `submitContact` Server Action
- `app/contact/page.tsx` — `/contact` Server Component (session email prefill)
- `components/contact/contact-form.tsx` — client form (`useActionState`)
- `components/ui/textarea.tsx` — shadcn primitive (CLI-generated, fallback included)

**Modify:**
- `app/sitemap.ts` — add `/contact`
- `components/site-footer.tsx` — add Contact link (also shows on account page)
- `app/page.tsx` — FAQ "Still have questions? Contact us" + FinalCTA "Get in touch" link
- `app/account/page.tsx` — "Need help?" section (7-day refund) linking to `/contact`

---

## Task 1: Migration — add contact columns + update Slack trigger

**Files:**
- Create: `supabase/migrations/20260605120000_add_contact_fields_to_feedback.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Adds web-contact-form fields to feedback so the landing/account /contact page can
-- reuse the existing feedback -> Slack pipeline. Web submissions are anonymous
-- (user_id null), so email/name come from the form. `source` distinguishes app vs web.
--
-- Also updates notify_slack_on_feedback() so web rows render correctly:
--   * email resolves to the typed email when there's no auth.users row (makes the
--     "Reply via email" button work for web),
--   * the optional name shows in the header,
--   * the footer shows "via website" instead of the null app diagnostics.

alter table public.feedback
  add column name   text check (name  is null or char_length(name)  <= 200),
  add column email  text check (email is null or char_length(email) <= 320),
  add column source text not null default 'app' check (source in ('app', 'web'));

create or replace function public.notify_slack_on_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_email text;
  v_name text;
  v_from text;
  v_preview text;
  v_short_id text;
  v_footer text;
  v_subject text;
  v_subject_encoded text;
  v_mailto text;
  v_studio_url text;
  v_actions jsonb;
  v_blocks jsonb;
begin
  select decrypted_secret
    into v_url
    from vault.decrypted_secrets
   where name = 'slack_feedback_webhook_url'
   limit 1;

  if v_url is null or v_url = '' then
    return new;
  end if;

  -- Authenticated submitters resolve via auth.users; web contact form supplies new.email.
  select email into v_email
    from auth.users
   where id = new.user_id
   limit 1;
  v_email := coalesce(v_email, new.email);

  v_name := nullif(btrim(coalesce(new.name, '')), '');
  if v_name is not null then
    v_from := v_name || ' `' || coalesce(v_email, '(unknown)') || '`';
  else
    v_from := '`' || coalesce(v_email, '(unknown)') || '`';
  end if;

  v_preview := left(new.message, 500);
  if char_length(new.message) > 500 then
    v_preview := v_preview || '…';
  end if;

  v_short_id := left(new.id::text, 8);

  if new.source = 'web' then
    v_footer := '_🌐 via website_  •  `' || v_short_id || '`';
  else
    v_footer :=
      '_' ||
      coalesce(new.app_version, '?') ||
      ' (' || coalesce(new.build_number, '?') || ') · ' ||
      coalesce(new.os_version, '?') ||
      '_  •  `' || v_short_id || '`';
  end if;
  if new.logs is not null then
    v_footer := v_footer || E'\n📎 _logs attached_';
  end if;

  v_blocks := jsonb_build_array(
    jsonb_build_object(
      'type', 'section',
      'text', jsonb_build_object(
        'type', 'mrkdwn',
        'text',
          '💬 *Feedback from* ' || v_from ||
          E'\n\n> ' || replace(v_preview, E'\n', E'\n> ') ||
          E'\n\n' || v_footer
      )
    )
  );

  v_actions := '[]'::jsonb;

  if v_email is not null then
    v_subject := 'Re: Your Woven feedback [' || v_short_id || ']';
    v_subject_encoded := v_subject;
    v_subject_encoded := replace(v_subject_encoded, '%', '%25');
    v_subject_encoded := replace(v_subject_encoded, ' ', '%20');
    v_subject_encoded := replace(v_subject_encoded, ':', '%3A');
    v_subject_encoded := replace(v_subject_encoded, '[', '%5B');
    v_subject_encoded := replace(v_subject_encoded, ']', '%5D');
    v_mailto := 'mailto:' || v_email || '?subject=' || v_subject_encoded;

    v_actions := v_actions || jsonb_build_array(
      jsonb_build_object(
        'type', 'button',
        'text', jsonb_build_object('type', 'plain_text', 'text', 'Reply via email'),
        'url', v_mailto
      )
    );
  end if;

  v_studio_url :=
    'https://supabase.com/dashboard/project/rlhjpovwwsqdeklhnvfl/sql/new?content=' ||
    'select%20*%20from%20public.feedback%20where%20id%20%3D%20%27' ||
    new.id::text || '%27%3B';

  v_actions := v_actions || jsonb_build_array(
    jsonb_build_object(
      'type', 'button',
      'text', jsonb_build_object('type', 'plain_text', 'text', 'View full row in Supabase'),
      'url', v_studio_url
    )
  );

  v_blocks := v_blocks || jsonb_build_array(
    jsonb_build_object('type', 'actions', 'elements', v_actions)
  );

  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('blocks', v_blocks),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  exception when others then
    raise log 'slack feedback notify failed: %', sqlerrm;
  end;

  return new;
end;
$$;
```

> Note: the `on_feedback_created_slack_notify` trigger created in the original migration stays bound; `create or replace function` swaps the body without touching it (same pattern as `20260523140000_add_logs_to_feedback.sql`).

- [ ] **Step 2: Apply locally and verify schema + trigger**

Run (requires local Supabase; `supabase start` first if not running):
```bash
supabase migration up
```
Expected: applies `20260605120000_add_contact_fields_to_feedback` with no error.

Verify columns and that an insert fires the trigger as a no-op locally (secret not seeded):
```bash
supabase db diff --schema public >/dev/null 2>&1; \
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" \
  -c "insert into public.feedback (message, email, name, source) values ('plan smoke test','test@example.com','Tester','web') returning id, source, email, name;"
```
Expected: one row returned with `source=web`, the email and name set. (No Slack call locally — the Vault secret is intentionally absent, so the trigger returns early.)

> If local Supabase isn't set up, skip the psql check; the migration ships to prod via the **release-woven-web** skill (Task 10). At minimum confirm the SQL parses: `supabase db lint` or apply on a preview branch.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605120000_add_contact_fields_to_feedback.sql
git commit -m "feat(contact): add name/email/source to feedback + web-aware Slack trigger"
```

---

## Task 2: Add the `textarea` UI primitive

**Files:**
- Create: `components/ui/textarea.tsx`

- [ ] **Step 1: Generate via the shadcn CLI**

Run:
```bash
pnpm dlx shadcn@latest add textarea
```
Expected: creates `components/ui/textarea.tsx` in the repo's `base-nova` style and exports `Textarea`.

- [ ] **Step 2: If the CLI is unavailable/offline, create it manually (fallback)**

Only if Step 1 did not produce the file, create `components/ui/textarea.tsx` (mirrors `components/ui/input.tsx` styling):

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

- [ ] **Step 3: Verify it builds**

Run: `pnpm lint`
Expected: no errors referencing `components/ui/textarea.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/ui/textarea.tsx
git commit -m "feat(ui): add textarea primitive"
```

---

## Task 3: Pure validation helper

**Files:**
- Create: `lib/contact/validation.ts`

- [ ] **Step 1: Write the validation module**

```ts
// Pure, dependency-free validation for the contact form. Kept separate from the
// Server Action so it can be reasoned about (and unit-tested) in isolation.
// Mirrors the feedback table CHECK constraints (message 1..10000, name <=200,
// email <=320). Email format is a deliberately loose sanity check.

export type ContactInput = {
  name: string;
  email: string;
  message: string;
};

export type ContactValidationResult =
  | { ok: true; data: { name: string | null; email: string; message: string } }
  | { ok: false; errors: Record<string, string[]> };

export const NAME_MAX = 200;
export const EMAIL_MAX = 320;
export const MESSAGE_MAX = 10000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(input: ContactInput): ContactValidationResult {
  const name = input.name.trim();
  const email = input.email.trim();
  const message = input.message.trim();

  const errors: Record<string, string[]> = {};

  if (!email) {
    errors.email = ["Please enter your email."];
  } else if (email.length > EMAIL_MAX) {
    errors.email = ["That email is too long."];
  } else if (!EMAIL_RE.test(email)) {
    errors.email = ["Please enter a valid email address."];
  }

  if (!message) {
    errors.message = ["Please enter a message."];
  } else if (message.length > MESSAGE_MAX) {
    errors.message = [`Message must be ${MESSAGE_MAX} characters or fewer.`];
  }

  if (name.length > NAME_MAX) {
    errors.name = [`Name must be ${NAME_MAX} characters or fewer.`];
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: { name: name || null, email, message } };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If the repo's `tsc` config emits, use `pnpm lint` plus the build in Task 4 instead.)

- [ ] **Step 3: Commit**

```bash
git add lib/contact/validation.ts
git commit -m "feat(contact): pure validation helper for the contact form"
```

---

## Task 4: Server Action — `submitContact`

**Files:**
- Create: `app/contact/actions.ts`
- Reference: `lib/supabase/admin.ts` (`createSupabaseAdminClient`), `lib/contact/validation.ts`

- [ ] **Step 1: Write the action**

```ts
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
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm lint`
Expected: no errors in `app/contact/actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/contact/actions.ts
git commit -m "feat(contact): submitContact server action (honeypot + throttle + service-role insert)"
```

---

## Task 5: Client form component

**Files:**
- Create: `components/contact/contact-form.tsx`
- Reference: `app/contact/actions.ts`, `components/ui/{field,input,textarea,button}.tsx`

- [ ] **Step 1: Write the form**

```tsx
"use client";

import { useActionState } from "react";

import { submitContact, type ContactState } from "@/app/contact/actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const initialState: ContactState = { status: "idle" };

export function ContactForm({ prefillEmail }: { prefillEmail?: string }) {
  const [state, formAction, pending] = useActionState(
    submitContact,
    initialState,
  );

  if (state.status === "success") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Thanks — message sent.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll get back to you{state.email ? ` at ${state.email}` : ""} soon.
        </p>
      </div>
    );
  }

  const errors = state.status === "error" ? state.errors : {};
  const values = state.status === "error" ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {errors._form ? (
        <p className="text-sm text-destructive" role="alert">
          {errors._form[0]}
        </p>
      ) : null}

      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            name="name"
            defaultValue={values?.name}
            disabled={pending}
            autoComplete="name"
            aria-invalid={!!errors.name}
          />
          {errors.name ? <FieldError>{errors.name[0]}</FieldError> : null}
        </Field>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={values?.email ?? prefillEmail}
            disabled={pending}
            autoComplete="email"
            aria-invalid={!!errors.email}
          />
          {errors.email ? <FieldError>{errors.email[0]}</FieldError> : null}
        </Field>

        <Field data-invalid={!!errors.message}>
          <FieldLabel htmlFor="message">Message</FieldLabel>
          <Textarea
            id="message"
            name="message"
            required
            rows={6}
            className="min-h-[140px]"
            defaultValue={values?.message}
            disabled={pending}
            aria-invalid={!!errors.message}
          />
          {errors.message ? (
            <FieldError>{errors.message[0]}</FieldError>
          ) : (
            <FieldDescription>
              For a refund within your 7-day window, include your account email.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      {/* Honeypot: off-screen, hidden from humans and assistive tech, tempting to bots. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
        <label htmlFor="company">Company</label>
        <input
          id="company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `pnpm lint`
Expected: no errors in `components/contact/contact-form.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/contact/contact-form.tsx
git commit -m "feat(contact): contact form client component"
```

---

## Task 6: `/contact` page

**Files:**
- Create: `app/contact/page.tsx`
- Reference: `app/changelog/page.tsx` (local `SiteHeader` pattern), `lib/supabase/server.ts`

- [ ] **Step 1: Write the page**

```tsx
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ContactForm } from "@/components/contact/contact-form";
import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the Woven team — questions, feedback, or a refund within your 7-day money-back window.",
  alternates: { canonical: "/contact" },
};

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="Woven home">
          <Image
            src="/woven-logo.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="font-heading text-base font-medium">Woven</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/#faq" className="hover:text-foreground">
            FAQ
          </Link>
          <Link href="/changelog" className="hover:text-foreground">
            Changelog
          </Link>
        </nav>
        <HeaderAuthControls />
      </div>
    </header>
  );
}

export default async function ContactPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <section className="pb-24 pt-16 md:pt-20">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
                Get in touch.
              </h1>
              <p className="text-base text-muted-foreground">
                Questions, feedback, or a refund within your 7-day money-back
                window — send a note and we&apos;ll get back to you. You can also
                email{" "}
                <a
                  href="mailto:hello@woven.video"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  hello@woven.video
                </a>
                .
              </p>
            </div>
            <ContactForm prefillEmail={user?.email ?? undefined} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds and renders**

Run: `pnpm build`
Expected: build succeeds; `/contact` appears in the route output.

Then run `pnpm dev`, open `http://localhost:3000/contact`, and confirm the header, form (Name/Email/Message), and footer render. If logged in locally, the email field is pre-filled.

- [ ] **Step 3: Commit**

```bash
git add app/contact/page.tsx
git commit -m "feat(contact): /contact page with session email prefill"
```

---

## Task 7: Sitemap + footer link

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `components/site-footer.tsx`

- [ ] **Step 1: Add `/contact` to the sitemap**

In `app/sitemap.ts`, add this entry to the returned array (after the `/changelog` entry):

```ts
    {
      url: `${siteUrl}/contact`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.5,
    },
```

- [ ] **Step 2: Add the Contact link to the footer**

In `components/site-footer.tsx`, inside the link row `<div className="flex items-center gap-6 ...">`, add a Contact link immediately before the `hello@woven.video` mailto anchor:

```tsx
          <Link href="/contact" className="hover:text-foreground">
            Contact
          </Link>
```

(`Link` is already imported in `site-footer.tsx`.)

- [ ] **Step 3: Verify**

Run: `pnpm lint`
Expected: no errors. Confirm the footer (visible on `/`, `/account`, etc.) now shows a Contact link.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.ts components/site-footer.tsx
git commit -m "feat(contact): sitemap entry + footer Contact link"
```

---

## Task 8: Landing-page links (FAQ + FinalCTA)

**Files:**
- Modify: `app/page.tsx` (FAQ section ~lines 597-605; FinalCTA ~after line 666)

- [ ] **Step 1: Update the FAQ "Anything else?" paragraph**

In `app/page.tsx`, replace the FAQ paragraph:

```tsx
            <p className="text-base text-muted-foreground">
              Anything else?{" "}
              <a
                href="mailto:hello@woven.video"
                className="text-foreground underline-offset-4 hover:underline"
              >
                hello@woven.video
              </a>
            </p>
```

with:

```tsx
            <p className="text-base text-muted-foreground">
              Still have questions?{" "}
              <Link
                href="/contact"
                className="text-foreground underline-offset-4 hover:underline"
              >
                Contact us
              </Link>{" "}
              or email{" "}
              <a
                href="mailto:hello@woven.video"
                className="text-foreground underline-offset-4 hover:underline"
              >
                hello@woven.video
              </a>
            </p>
```

(`Link` is already imported at the top of `app/page.tsx`.)

- [ ] **Step 2: Add a "Get in touch" link to FinalCTA**

In `app/page.tsx`, in the `FinalCTA` component, add this paragraph immediately after the closing `</Button>` (download button) and before the closing `</div>` of the inner container:

```tsx
        <p className="text-sm text-background/60">
          Questions before you download?{" "}
          <Link
            href="/contact"
            className="text-background underline underline-offset-4"
          >
            Get in touch
          </Link>
        </p>
```

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: build succeeds. Load `/` and confirm the FAQ shows "Contact us" and the bottom CTA shows "Get in touch", both linking to `/contact`.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(contact): landing-page FAQ + CTA links to /contact"
```

---

## Task 9: Account page "Need help?" section

**Files:**
- Modify: `app/account/page.tsx` (add `Link` import; add a section after the Activity `<section>`)

- [ ] **Step 1: Ensure `Link` is imported**

At the top of `app/account/page.tsx`, add (if not already present):

```ts
import Link from "next/link";
```

- [ ] **Step 2: Add the support section**

In `app/account/page.tsx`, add this section immediately after the closing `</section>` of the "Activity" section and before the final closing `</div>` of the returned tree:

```tsx
      <section className="flex flex-col gap-2 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <h2 className="font-heading text-lg font-medium">Need help?</h2>
        <p className="text-sm text-muted-foreground">
          Questions about your account, or want a refund within your 7-day
          money-back window?{" "}
          <Link
            href="/contact"
            className="text-foreground underline underline-offset-4 hover:no-underline"
          >
            Contact us
          </Link>
          .
        </p>
      </section>
```

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: build succeeds. Load `/account` (logged in) and confirm the "Need help?" card appears with a working link to `/contact`.

- [ ] **Step 4: Commit**

```bash
git add app/account/page.tsx
git commit -m "feat(contact): account-page Need help / refund link to /contact"
```

---

## Task 10: End-to-end verification + release

- [ ] **Step 1: Full local verification pass**

With `pnpm dev` running:
1. `/contact` → submit valid Name/Email/Message → success panel appears.
2. Confirm a row landed: query `select id, name, email, source, user_id from public.feedback order by created_at desc limit 1;` → `source='web'`, `user_id` null, name/email set.
3. Submit with empty email and empty message → inline field errors; typed values preserved.
4. Submit with `message` > 10000 chars → message error.
5. Fill the hidden `company` field via devtools and submit → success panel but **no** new row.
6. Logged-in: `/contact` email field pre-filled from the session.
7. Footer Contact link, landing FAQ "Contact us", landing CTA "Get in touch", and account "Need help?" all navigate to `/contact`.

- [ ] **Step 2: Build + lint clean**

Run: `pnpm build && pnpm lint`
Expected: both succeed with no errors.

- [ ] **Step 3: Open PR**

```bash
git push -u origin contact-page
gh pr create --title "feat: /contact page wired to the feedback→Slack pipeline" --body "$(cat <<'EOF'
Adds a /contact page (footer + landing + account entry points) whose submissions reuse the existing feedback → notify_slack_on_feedback() → Slack pipeline. Anonymous service-role insert with source='web'; migration adds name/email/source and makes the Slack trigger web-aware (typed email powers the Reply button). Honeypot + light throttle; email pre-fills from the session on /contact.

Spec: docs/superpowers/specs/2026-06-05-contact-page-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> Do not merge without asking (see project convention; no `--admin`).

- [ ] **Step 4: Release to prod (after merge)**

Use the **release-woven-web** skill — it ships the migration `20260605120000_add_contact_fields_to_feedback.sql` to prod Supabase. No new env vars: the service-role key and the `slack_feedback_webhook_url` Vault secret already exist. After deploy, submit a real `/contact` message in prod and confirm the Slack message renders with the name + typed email, a working **Reply via email** button, and the `🌐 via website` footer.

---

## Self-Review

**Spec coverage:**
- `/contact` page + form + Server Action → Tasks 4, 5, 6 ✓
- Migration (name/email/source) + web-aware trigger → Task 1 ✓
- Service-role anonymous insert, `source='web'`, no `user_id` → Task 4 ✓
- Honeypot + light per-IP throttle → Task 4 ✓
- Hand-rolled validation, no zod → Task 3 ✓
- shadcn `textarea` via CLI; reuse existing Field family → Task 2, 5 ✓
- Email prefill from session (still anonymous) → Tasks 4/6 ✓
- Footer link (also on account page via layout) → Task 7 ✓
- Landing CTA + FAQ line → Task 8 ✓ (integrated into existing `FinalCTA` rather than a redundant new section — noted deviation from spec wording, same intent)
- Account "Need help?" / 7-day refund section → Task 9 ✓
- Verify (build/lint/manual) + release via release-woven-web → Task 10 ✓
- Out of scope (Turnstile, user_id linking, topic dropdown) → not implemented ✓

**Placeholder scan:** none — every code/SQL step is complete.

**Type consistency:** `ContactState` (Task 4) is consumed unchanged in Task 5; `validateContact`/`ContactValidationResult` (Task 3) used as-is in Task 4; `ContactForm` prop `prefillEmail?: string` (Task 5) matches the `user?.email ?? undefined` passed in Task 6.
