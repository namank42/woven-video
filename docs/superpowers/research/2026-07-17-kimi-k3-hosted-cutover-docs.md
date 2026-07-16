# Docs Digest — Kimi K3 hosted cutover — 2026-07-17

## Vercel AI Gateway (context7: `/websites/vercel_ai-gateway`) — live service

- `GET https://ai-gateway.vercel.sh/v1/models` is public and returns canonical model IDs, context
  windows, maximum output tokens, capability tags, and per-token pricing.
- Kimi K3 is live under the exact Gateway ID `moonshotai/kimi-k3`, released July 16, 2026.
- The live model record reports:
  - context window: `1_000_000` tokens;
  - maximum output: `131_072` tokens;
  - tags: `reasoning`, `tool-use`, `implicit-caching`, `file-input`, and `vision`;
  - input: `$0.000003` per token (`$3.00/M`);
  - output: `$0.000015` per token (`$15.00/M`);
  - cached input read: `$0.0000003` per token (`$0.30/M`);
  - no cache-write price.
- The model-specific endpoint
  `GET /v1/models/moonshotai/kimi-k3/endpoints` reports one Moonshot endpoint with
  `text+image+file -> text` architecture. Its supported parameters include `max_tokens`,
  `temperature`, `stop`, `tools`, `tool_choice`, `reasoning`, and `include_reasoning`.
- The Vercel launch note says thinking mode is always on. Woven should therefore publish K3 as
  reasoning-capable with no selectable effort tiers and no default effort override:
  `supports_reasoning: true`, `supported_reasoning_efforts: []`, and
  `default_reasoning_effort: null`.
- The launch note also mentions video input, but the live executable endpoint does not currently
  advertise video in `architecture.input_modalities`. Treat the live endpoint as runtime truth for
  this cutover: expose image/file support through existing enrichment and do not promise video input.
- Woven's approved 20% hosted markup produces exact public rates of `$3.60/M` input, `$18.00/M`
  output, and `$0.36/M` cached input read; cache write remains `—`.
- Sources:
  - Context7 `/websites/vercel_ai-gateway`
  - https://vercel.com/changelog/kimi-k3-is-now-available-on-ai-gateway
  - https://vercel.com/ai-gateway/models/kimi-k3
  - https://ai-gateway.vercel.sh/v1/models
  - https://ai-gateway.vercel.sh/v1/models/moonshotai/kimi-k3/endpoints

## Moonshot AI API — current K3 docs unavailable in Context7

- Context7 did not return an official Moonshot AI documentation library, and Moonshot's indexed
  public API documentation had not yet added K3-specific material at research time.
- The design therefore uses Vercel's official launch note, public model catalog, and live endpoint
  metadata as the executable provider contract. A direct authenticated Gateway smoke remains a
  release gate before production cutover.

## Next.js — `16.2.3` installed

- This cutover does not introduce a new Next.js API or convention. Public pricing and SEO changes
  update existing static data modules and existing route content only.
- Before implementation, read the relevant local Next.js 16.2.3 guides under
  `node_modules/next/dist/docs/` as required by the repository instructions.
