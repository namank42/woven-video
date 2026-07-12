# Docs Digest — GPT-5.6 Sol and Terra — 2026-07-12

## Vercel AI Gateway (context7: `/websites/vercel_ai-gateway`) — hosted REST API

- This repo does not install an AI Gateway SDK. It calls the hosted REST API through
  `AI_GATEWAY_BASE_URL`, which defaults to `https://ai-gateway.vercel.sh/v1`.
- `GET /v1/models` lists the current Gateway catalog without authentication. Each language-model
  row includes its `provider/model` ID, context window, maximum output, capability tags, and
  per-token pricing.
- `GET /v1/models/{model_id}/endpoints` returns the model architecture, provider endpoints,
  context length, maximum completion tokens, supported parameters, status, and endpoint pricing.
- `POST /v1/chat/completions` and `POST /v1/responses` accept Gateway IDs in
  `provider/model` form. Woven currently uses the Chat Completions endpoint.
- Source: Context7 `/websites/vercel_ai-gateway`, Vercel AI Gateway REST API docs.

### Live Gateway catalog verification — 2026-07-12

The live unauthenticated Gateway catalog and endpoint metadata expose both requested models:

- `openai/gpt-5.6-sol` — display name `GPT 5.6 Sol`
- `openai/gpt-5.6-terra` — display name `GPT 5.6 Terra`

Both currently report:

- 1,050,000-token context window
- 128,000 maximum completion tokens
- text, image, and file input; text output
- reasoning, tools, tool choice, vision, file input, and implicit caching
- active OpenAI and Azure provider endpoints (`status: 0`)

The live base provider prices and the resulting Woven prices after the existing 20% markup are:

| Model | Tier | Provider input/M | Woven input/M | Provider output/M | Woven output/M | Provider cache read/M | Woven cache read/M | Provider cache write/M | Woven cache write/M |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Sol | up to 272K input tokens | $5.00 | $6.00 | $30.00 | $36.00 | $0.50 | $0.60 | $6.25 | $7.50 |
| Sol | over 272K input tokens | $10.00 | $12.00 | $45.00 | $54.00 | $1.00 | $1.20 | $12.50 | $15.00 |
| Terra | up to 272K input tokens | $2.50 | $3.00 | $15.00 | $18.00 | $0.25 | $0.30 | $3.125 | $3.75 |
| Terra | over 272K input tokens | $5.00 | $6.00 | $22.50 | $27.00 | $0.50 | $0.60 | $6.25 | $7.50 |

Live sources:

- `https://ai-gateway.vercel.sh/v1/models`
- `https://ai-gateway.vercel.sh/v1/models/openai/gpt-5.6-sol/endpoints`
- `https://ai-gateway.vercel.sh/v1/models/openai/gpt-5.6-terra/endpoints`

## OpenAI API (context7: `/websites/developers_openai_api`) — hosted API

- OpenAI's current model guidance describes GPT-5.6 Sol as the complex reasoning/coding model and
  GPT-5.6 Terra as the intelligence/cost balance.
- Current OpenAI docs list `gpt-5.6-sol` and `gpt-5.6-terra` for Chat Completions and describe the
  GPT-5.6 family as available through the Responses API and client SDKs. These are developer-API
  models, not only Codex App Server catalog names.
- The Gateway adds the `openai/` provider prefix; Woven pricing rows and upstream requests must use
  the full Gateway IDs rather than the bare OpenAI IDs.
- Source: Context7 `/websites/developers_openai_api`, OpenAI model and API guides.

## Contract implications for Woven

- The existing Woven integration already uses the documented Gateway surfaces: Chat Completions for
  inference and per-model endpoint metadata for capabilities/pricing.
- The current capability parser reads only the first/base pricing values and does not expose tier
  arrays. That is sufficient for model discovery but cannot represent the higher price above 272K
  input tokens without an additive contract change.
- Gateway generation accounting remains the source for final provider cost, so actual settlement can
  reflect tiered provider billing even if the catalog response continues to show only base prices.
