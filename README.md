# Woven Video

Website and backend foundation for Woven. The desktop app lives in `~/projects/woven-harness`; this repo owns the companion website, Supabase Auth/Postgres, prepaid balance ledger, Stripe top-ups, hosted model/media APIs, and generated artifact storage.

## Local Development

Run the website:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Run the local Supabase stack:

```bash
supabase start
supabase db reset
```

Copy `.env.example` to `.env.local` and fill the local keys printed by `supabase start`, plus Stripe test secrets when testing checkout.

Google login also needs `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` available to Supabase CLI, either exported in your shell or stored in a local root `.env` file before running `supabase start`. In Google Cloud, authorize `http://localhost:54321/auth/v1/callback` as the local redirect URI.

Hosted Woven model calls use Vercel AI Gateway. Set `AI_GATEWAY_API_KEY` in `.env.local` before calling `/api/v1/chat/completions`.

## Backend Foundation

Supabase files live under `supabase/`:

- `supabase/migrations/20260429000100_init_billing_system.sql`
- `supabase/functions/create-checkout-session`
- `supabase/functions/stripe-webhook`

Architecture details are in [docs/billing-architecture.md](docs/billing-architecture.md).

## Scripts

```bash
pnpm lint
pnpm build
```
