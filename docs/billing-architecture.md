# Woven Billing Architecture

Woven supports local/BYOK usage in the desktop app and optional prepaid balance for hosted compute. The website/backend owns cloud state, provider secrets, Stripe payments, balance accounting, and generated artifact storage.

## Local Supabase

Start the local Supabase stack from this repo:

```bash
supabase start
supabase db reset
```

The first command prints local keys. You can also run `supabase status -o env`; copy `ANON_KEY` into `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY`, and copy `SERVICE_ROLE_KEY` into `SUPABASE_SERVICE_ROLE_KEY`. Do not commit `.env.local`.

Useful local URLs:

- API: `http://127.0.0.1:54321`
- Studio: `http://127.0.0.1:54323`
- Email testing: `http://127.0.0.1:54324`

Serve Edge Functions locally when testing Stripe flows:

```bash
supabase functions serve --env-file .env.local
```

## Balance Model

Woven balance is prepaid and denominated in USD. Users see dollars in the product; the backend stores integer micro-dollars (`usd_micros`) so tiny hosted chat calls can be charged at provider cost plus markup without rounding every request up to a cent.

The account page offers quick top-ups plus a custom amount:

- `$10.00`
- `$20.00`
- `$50.00`
- Custom top-ups from `$5.00` to `$100.00`

Stripe top-ups remain normal dollar/cents amounts. The webhook converts Stripe cents into `usd_micros` at the boundary: `$1.00 = 1,000,000 usd_micros`, `$0.01 = 10,000 usd_micros`.

Hosted model and media pricing should produce estimated and final costs in `usd_micros`. Provider costs remain decimal USD values for auditability, while ledger debits use integer micros.

## Tables

`profiles` mirrors the Supabase Auth user and stores the Stripe customer ID.

`billing_accounts` gives each user one USD balance account today. The `currency` column leaves room for future currencies or team/org balances.

`model_pricing_rules` lists Woven-hosted models, reserve amounts, minimum charges, and Woven markup. V1 starts with `markup_bps = 2000` (20%). Reservations are small temporary holds in `usd_micros`; final settlement uses provider cost plus markup after usage is known.

Initial hosted chat models:

- `anthropic/claude-sonnet-4.6`
- `anthropic/claude-opus-4.7`
- `anthropic/claude-haiku-4.5`
- `openai/gpt-5.5`

`ledger_entries` is the append-only ledger. Every balance-changing operation writes an entry with `amount_usd_micros` and `balance_after_usd_micros`. The unique `(source, source_id, kind)` constraint is the idempotency boundary for Stripe webhooks and job accounting.

`generation_jobs` tracks hosted compute work. Long media work should move through a queue/worker; Edge Functions should only create jobs, validate auth, reserve funds, and receive short webhook callbacks.

`usage_events` records provider usage, raw provider cost, and Woven charged amount for auditability.

The `generated-media` storage bucket is private. Authenticated users can read objects stored under a top-level folder named with their user ID.

## RPC Contract

Client-readable:

- `get_billing_balance()` returns the authenticated user account and `balance_usd_micros`.

Service-role only:

- `ensure_billing_account(user_id)` creates missing profile/account rows.
- `grant_balance(user_id, amount_usd_micros, source, source_id, kind, metadata)` grants positive balance idempotently.
- `reserve_balance(user_id, job_id, amount_usd_micros, metadata)` debits a reservation for a queued job.
- `settle_balance_reservation(job_id, final_cost_usd_micros, output, metadata)` finalizes a successful job and releases or charges the reservation delta.
- `release_balance_reservation(job_id, status, error, metadata)` releases reserved funds for failed or cancelled work.

Authenticated users can read their own profile, account, ledger, jobs, and usage events through RLS. They cannot directly insert ledger entries or mark jobs complete.

## Stripe Flow

`create-checkout-session` is authenticated. It validates the requested top-up amount, creates or reuses a Stripe customer, and returns a Checkout URL with user/top-up metadata.

`stripe-webhook` is unauthenticated but verifies the Stripe signature. On `checkout.session.completed`, it calls `grant_balance` with the PaymentIntent ID as the idempotency key so duplicate webhook delivery cannot double-grant funds.

## Hosted LLM Flow

The Woven backend exposes an OpenAI-compatible surface for desktop-hosted usage:

- `GET /api/v1/models`
- `GET /api/v1/billing/balance`
- `POST /api/v1/chat/completions`

All routes require a Woven/Supabase bearer token. The desktop app should continue to run tools, file access, and chat orchestration locally. For Woven-hosted models, the sidecar points an OpenAI-compatible client at `/api/v1` and sends model IDs like `anthropic/claude-sonnet-4.6`.

The chat completion route:

1. Validates the bearer token.
2. Validates the requested model against `model_pricing_rules`.
3. Creates a `generation_jobs` row.
4. Calls `reserve_balance`.
5. Proxies the request to Vercel AI Gateway.
6. Streams or returns the gateway response.
7. Reads provider cost from the gateway response, falling back to generation lookup when needed.
8. Writes `usage_events`.
9. Calls `settle_balance_reservation`.

If the gateway request fails or the client cancels a stream before completion, the route calls `release_balance_reservation`.

## Hosted Web Tools

The desktop sidecar can route web search and web fetch through the Woven backend so users without their own Exa key consume Woven credits instead. Routes:

- `POST /api/v1/web/search` — body `{ "query": string }`, returns Exa's `/search` JSON.
- `POST /api/v1/web/fetch` — body `{ "url": string }`, returns Exa's `/contents` JSON.

Both require a Woven/Supabase bearer token and `EXA_API_KEY` set on the server. Pricing is flat per call (no token math):

| Tool | Raw cost (Exa) | Charged | Per 1k |
| ---- | -------------- | ------- | ------ |
| Web Search | ~$0.010 | $0.012 | $12 |
| Web Fetch | ~$0.005 | $0.006 | $6 |

20% markup matches chat (`markup_bps = 2000`). Pricing rows live in `model_pricing_rules` with `provider = 'exa'` and `operation` in (`'search'`, `'fetch'`); update via SQL to retune.

The route flow:

1. Validates the bearer token.
2. Looks up the pricing rule for the operation.
3. Creates a `generation_jobs` row with `type = 'web_search' | 'web_fetch'`.
4. Calls `reserve_balance` for the rule's `reserve_amount_usd_micros`.
5. Calls Exa with the server's `EXA_API_KEY`.
6. On success: writes `usage_events` (raw provider cost from `costDollars` if present, else 0) and calls `settle_balance_reservation` with the same amount as the reservation. The adjustment ledger entry is $0 since reserve = settle for flat-fee tools.
7. On failure or cancellation: calls `release_balance_reservation`.

Shared logic lives in `lib/billing/charge-flat-tool.ts` and is reusable for any future flat-fee external API.

## Job Flow

The intended hosted media/model flow is:

1. Backend estimates cost for the request.
2. Backend inserts a `generation_jobs` row.
3. Backend calls `reserve_balance`.
4. A worker runs the provider job using server-side provider secrets.
5. On success, backend records `usage_events` and calls `settle_balance_reservation`.
6. On failure or cancellation, backend calls `release_balance_reservation`.

Edge Functions are suitable for steps 1-3 and callback handling. Long-running image/video/voice/lipsync work should run in a worker process.

## Auth Flow

The web app uses one `/login` entrypoint with Google OAuth. Supabase creates a user on first successful Google sign-in, then the database trigger creates `profiles` and `billing_accounts`.

For local Google OAuth, configure a Google web OAuth client with:

- Authorized JavaScript origins: `http://localhost:3000` and `http://127.0.0.1:3000`
- Authorized redirect URI: `http://localhost:54321/auth/v1/callback`

Start the local site at `http://localhost:3000` when testing Google OAuth. The app starts OAuth through `/auth/login/google`, which builds the callback URL from the current browser origin so the PKCE verifier cookie and final callback stay on the same host.

Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` before restarting Supabase. The CLI reads shell environment variables or a root `.env` file for `supabase/config.toml`; the Next app reads `.env.local`.

If those values are missing, `supabase start` will warn and the login page will render, but Google sign-in cannot complete.
