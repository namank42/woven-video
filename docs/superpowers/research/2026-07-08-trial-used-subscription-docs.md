# Docs Digest - Trial-used subscription checkout - 2026-07-08

## Stripe Node (context7: /stripe/stripe-node) - v22.1.0 (installed in `supabase/functions/deno.json`)
- Checkout Session creation still uses `stripe.checkout.sessions.create({...})`.
- For the Woven subscription flow, use `mode: "subscription"`, `customer`, `client_reference_id`, `line_items: [{ price, quantity: 1 }]`, `success_url`, and `cancel_url`.
- A trial-eligible Checkout adds `payment_method_collection: "always"` and `subscription_data.trial_period_days: 7`.
- Trial safety remains `subscription_data.trial_settings.end_behavior.missing_payment_method: "cancel"`.
- A trial-used immediate subscription Checkout should keep `mode: "subscription"` and the same recurring price line item, but omit `trial_period_days` and `trial_settings`.
- Put `user_id`, `purpose`, and a new eligibility marker such as `trial_eligible: "true" | "false"` in both Session `metadata` and `subscription_data.metadata` so the webhook can read the same intent from either object.
- Source: context7 `/stripe/stripe-node`; Stripe API docs `https://docs.stripe.com/api/checkout/sessions/create`.

## Supabase JavaScript (context7: /supabase/supabase) - v2.105.1 (installed in `package.json` and `supabase/functions/deno.json`)
- Server-side code can call Postgres functions with `supabase.rpc("function_name", { arg_name: value })` and should check `{ data, error }`.
- Edge Functions can create a service-role client with `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` for internal reads/writes that bypass user RLS intentionally.
- User-scoped clients can still use the caller's JWT when RLS should apply; this repo's checkout function already authenticates with `requireAuthenticatedUser(req)` and then uses service role for billing-account/customer/subscription state.
- Source: context7 `/supabase/supabase`.

## Next.js App Router (context7: /vercel/next.js/v16.2.2 + local docs) - v16.2.3 (installed)
- Server Actions are async server functions marked by a top-level or inline `"use server"` directive.
- Forms can invoke Server Actions with `<form action={action}>`; the action may perform async work and then call `redirect(...)` from `next/navigation`.
- Server Actions are reachable as direct POST entry points, so each action must re-check authentication/authorization itself, even if the page rendering the form already checked auth.
- Existing account actions already follow this shape by calling Supabase auth inside the action, then redirecting to Stripe or back to `/account` with search params.
- Source: context7 `/vercel/next.js/v16.2.2`; local `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`; local `node_modules/next/dist/docs/01-app/02-guides/data-security.md`.
