# Contact page → feedback→Slack pipeline — Design

**Date:** 2026-06-05
**Status:** Approved (design), pending spec review
**Research digest:** `docs/superpowers/research/2026-06-05-nextjs-forms-contact.md`

## Goal

Give website visitors a way to reach us: a dedicated `/contact` page with a simple form,
reachable from the footer, the landing page, and the **account page** (so a paying user can ask
for a refund within their 7-day money-back window). Submissions flow into the **existing**
`public.feedback` → `notify_slack_on_feedback()` → Slack pipeline that the Mac app already uses,
so all inbound feedback lands in one Slack channel with one set of tooling.

## Background — the existing mechanism

- `public.feedback` — columns `id, user_id, message, app_version, build_number, os_version, logs,
  created_at`. RLS allows only `authenticated` users to insert their **own** row
  (`auth.uid() = user_id`); `anon` is fully revoked; `service_role` has `grant all`.
- `notify_slack_on_feedback()` — `after insert` trigger. Looks up the submitter's email from
  `auth.users` via `user_id`, posts a Slack Block Kit message (webhook URL in Supabase Vault,
  secret `slack_feedback_webhook_url`; a missing secret makes the trigger a no-op — true for local
  dev). Message shows: email, message preview (≤500 chars), diagnostics
  (`app_version (build) · os_version`), short id, a 📎 logs flag, and **Reply via email** +
  **View full row in Supabase** buttons.
- The Mac app inserts as an **authenticated** user, which is why the table forbids anon inserts.

**The core problem:** landing-page visitors are anonymous, but the table/RLS/trigger all assume an
authenticated user whose email lives in `auth.users`.

## Decisions (locked)

- **Insert path:** Server Action + service-role insert (Approach A). The table stays locked to the
  public; validation/honeypot/throttle live server-side. Chosen over granting `anon` insert
  (exposes the table to spam) and over a route handler (`app/api/v1/**` is the external product
  API; a first-party form is what Server Actions are for).
- **`source` column:** yes — `app` vs `web`, so the Slack footer is correct and we can filter later.
- **Logged-in visitors:** keep contact submissions **anonymous** (no `user_id`); use the typed
  email. But on `/contact`, **pre-fill the email field from the session** when the visitor is logged
  in (read-only convenience — still inserted anonymously).
- **Spam:** honeypot + best-effort per-IP throttle now; Cloudflare Turnstile is the escalation path
  if spam appears (not built now).
- **Form fields:** Name (optional) + Email (required) + Message (required).
- **Placement:** footer link (the footer also renders on the account page) + a Contact CTA section
  near the bottom of the landing page + a "Still have questions?" line at the end of the FAQ + a
  **"Need help?" support section on the account page** that links to `/contact` and notes the 7-day
  money-back guarantee. Plain Contact link — no refund-specific pre-fill / topic.

## Tech context (from research digest)

- Next 16.2.3 / React 19.2.4. Idiomatic form mutation = **Server Action** invoked with
  `useActionState` (`[state, formAction, pending]`); action signature `(prevState, formData)`.
- Server Actions are reachable via direct POST → the action MUST validate every field and carry its
  own spam mitigation (it is intentionally unauthenticated).
- `zod` is not a direct dependency; existing routes hand-roll validation. Follow that — no new dep.
- shadcn is `base-nova` style on `@base-ui/react`. The `Field` family already exists in
  `components/ui/field.tsx` (`Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `FieldError`,
  …). Only **`textarea`** is missing → add via `pnpm dlx shadcn@latest add textarea`.
- Sub-pages (pricing, changelog) inline their own header (logo `Link` + `HeaderAuthControls`) and
  use `SiteFooter`. `/contact` follows the same pattern.

## Components & data flow

```
/contact page (RSC)
  └─ <ContactForm/> (client)  --action-->  submitContact() (server action)
                                              ├─ honeypot check (silent success if tripped)
                                              ├─ validate (name/email/message)
                                              ├─ light per-IP throttle
                                              └─ insert into public.feedback (service role)
                                                     └─ trigger notify_slack_on_feedback() → Slack
```

### 1. Migration — `supabase/migrations/<ts>_add_contact_fields_to_feedback.sql`

```sql
alter table public.feedback
  add column name   text check (name  is null or char_length(name)  <= 200),
  add column email  text check (email is null or char_length(email) <= 320),
  add column source text not null default 'app' check (source in ('app','web'));
```
Then `create or replace function public.notify_slack_on_feedback()` with surgical changes only:
- **Email:** `v_email := coalesce((select email from auth.users where id = new.user_id), new.email)`.
- **Name in header:** when `new.name` is present, render it before the email
  (e.g. `*Feedback from* {name} \`{email}\``).
- **Footer:** if `new.source = 'web'`, footer reads `🌐 via website` instead of the
  `app_version (build) · os_version` diagnostics (null for web → currently `? (?) · ?`). Keep the
  short id, the 📎 logs flag, and both buttons. The **Reply via email** button now works for web
  because `v_email` is the typed email.
- Everything else (Studio link, http_post, error handling) unchanged.

Backward compatible: desktop inserts omit the new columns; `source` defaults to `app`; existing
rows get `source='app'`.

### 2. Server Action — `app/contact/actions.ts` (`'use server'`)

`submitContact(prevState, formData)` returning a discriminated state:
`{ ok: true } | { ok: false; errors: Record<string,string[]>; values: { name; email; message } }`.

Steps:
1. **Honeypot:** read hidden field `company`; if non-empty, return `{ ok: true }` without inserting.
2. **Extract & validate** (hand-rolled, mirroring `app/api/v1/reel-captions/jobs/route.ts`):
   - `email`: required, trimmed, matches a basic email regex, ≤320 chars.
   - `message`: required, trimmed, length 1–10000 (matches the table CHECK).
   - `name`: optional, trimmed, ≤200 chars.
   - On any failure → `{ ok:false, errors, values }` (echo `values` so the form isn't wiped).
3. **Throttle:** best-effort per-IP using `x-forwarded-for` (via `headers()` from `next/headers`),
   in-memory window (documented as soft / per-instance). Honeypot is the primary defense.
4. **Insert** via `createSupabaseAdminClient()`:
   `insert into feedback { message, name: name||null, email, source: 'web' }`. `user_id` stays null.
5. On insert error → `{ ok:false, errors: { _form: ["Something went wrong. Please try again."] } }`
   (log server-side, no detail leak). On success → `{ ok:true }`.

### 3. UI

- `components/ui/textarea.tsx` — generated by the shadcn CLI (base-nova variant).
- `components/contact/contact-form.tsx` (`"use client"`):
  - `const [state, formAction, pending] = useActionState(submitContact, initialState)`.
  - `<form action={formAction}>` with `FieldGroup` → three `Field`s (name/email/message). Inputs use
    `name=`, `defaultValue={state.values?.x}`, `disabled={pending}`,
    `aria-invalid={!!state.errors?.x}`; render `<FieldError>{state.errors.x[0]}</FieldError>`.
    Message uses `<Textarea className="min-h-[140px]">`.
  - Hidden honeypot: `<input type="text" name="company" tabIndex={-1} autoComplete="off"` visually
    hidden, `aria-hidden`).
  - Submit `<Button disabled={pending}>` (label flips to "Sending…"); form-level error from
    `state.errors?._form`.
  - On `state.ok` → replace the form with a success panel
    ("Thanks — we'll get back to you at {email}.").
  - Accepts a `prefillEmail?: string` prop; the email field uses
    `defaultValue={state.values?.email ?? prefillEmail}` (a failed-submit value wins over the
    prefill).
- `app/contact/page.tsx` (RSC): `metadata` (title "Contact", canonical `/contact`); inline header
  (logo `Link` + `HeaderAuthControls`) matching pricing/changelog; intro copy; `<ContactForm/>`;
  `hello@woven.video` shown as a fallback; `<SiteFooter/>`. Add `/contact` to `app/sitemap.ts`.
  Reads the session via `createSupabaseServerClient()` and passes
  `prefillEmail={user?.email}` to `<ContactForm/>` (logged-in convenience; the insert stays
  anonymous regardless).

### 4. Placement edits

- `components/site-footer.tsx` — add `<Link href="/contact">Contact</Link>` to the link row (keep
  the `hello@woven.video` mailto).
- `app/page.tsx` — a short **Contact CTA** section above the footer ("Questions? Get in touch →"
  linking to `/contact`), and a **"Still have questions? Contact us →"** line after the FAQ
  accordion.
- `app/account/page.tsx` — a **"Need help?" support section** (near the bottom, after Activity):
  short copy noting the 7-day money-back guarantee with a link to `/contact`. No embedded form; the
  `SiteFooter` Contact link (rendered by `app/account/layout.tsx`) is the secondary path.

## Error handling

- Client: HTML `required` + `type="email"` for instant feedback; server validation is authoritative
  and renders via `FieldError`. Network/unknown failure → form-level error, form stays filled.
- Server: invalid input → structured `errors`; insert failure → generic message + server log; Slack
  failure is already swallowed inside the trigger (won't fail the insert).
- Honeypot trip → looks like success to the bot, nothing written.

## Testing / verification

No test runner in this repo (lint only). Verification:
- `pnpm build` + `pnpm lint` clean.
- Manual local: valid submit inserts a `source='web'` row; missing/invalid email and empty message
  show field errors and preserve input; honeypot-filled submit writes nothing but shows success;
  oversized message rejected.
- Slack: the Vault secret is not seeded locally (trigger no-ops), so confirm the rendered Slack
  message (name + email header, `🌐 via website` footer, working Reply button) on preview/prod.

## Release

Ships via the **release-woven-web** skill (contains a DB migration). No new env vars — the
service-role key and the `slack_feedback_webhook_url` Vault secret already exist in prod.

## Out of scope / future

- Cloudflare Turnstile (add if spam appears).
- Linking submissions to a logged-in `user_id`.
- A topic/category dropdown.
- An in-app admin view of feedback (still read via Supabase Studio).
```
