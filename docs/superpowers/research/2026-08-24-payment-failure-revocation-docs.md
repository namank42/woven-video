# Docs Digest - Payment Failure Revocation - 2026-08-24

## Stripe Billing - current

- A failed automatic subscription payment moves the subscription to `past_due`.
- Smart Retries runs for the account-configured number of attempts and maximum duration. At the end of that window, Stripe can cancel the subscription, mark it unpaid, or leave it past due.
- A successful payment returns the subscription to `active`.
- Source: https://docs.stripe.com/billing/revenue-recovery/smart-retries
- Source: https://docs.stripe.com/billing/subscriptions/overview

## Supabase Realtime Postgres Changes - current

- The table must be part of the `supabase_realtime` publication, for example `alter publication supabase_realtime add table public.subscriptions`.
- Postgres Changes respects the subscriber's row-level security policy. The existing `subscriptions` select policy already limits each authenticated user to their own rows.
- Supabase Swift registers an `UpdateAction` with `channel.postgresChange`, scopes it by schema, table, and an equality filter, then awaits the changes after `channel.subscribe()`.
- Source: https://supabase.com/docs/guides/realtime/postgres-changes

## supabase-swift - v2.55.1

- Pin the Harness package to exact version `2.55.1`; the generated package lock is ignored and the broad `from: "2.0.0"` declaration does not guarantee the reconnect fixes used by this design.
- `SupabaseClient.channel(...)` creates a `RealtimeChannelV2`; `SupabaseClient.removeChannel(...)` removes it.
- Register `channel.postgresChange(AnyAction.self, schema: "public", table: "subscriptions", filter: .eq("user_id", value: userID.uuidString))` before calling `channel.subscribeWithError()`.
- `channel.statusChange` emits the current status immediately and subsequent status changes. Use it to refresh after initial subscription and after reconnection.
- Source: installed package checkout at tag `v2.55.1`, `Sources/RealtimeV2/RealtimeChannel+AsyncAwait.swift`, `Sources/RealtimeV2/RealtimeChannel+Status.swift`, and `Sources/Supabase/SupabaseClient.swift`.

## XcodeGen project spec - current

- A remote Swift package can be pinned with `exactVersion: 2.55.1` (or `version: 2.55.1`) under the package URL.
- Source: https://yonaskolb.github.io/XcodeGen/Docs/ProjectSpec.html#remote-package
