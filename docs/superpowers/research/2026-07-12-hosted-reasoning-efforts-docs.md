# Docs Digest — Hosted Reasoning Efforts — 2026-07-12

## Vercel AI Gateway (context7: `/websites/vercel_ai-gateway`) — hosted REST API

- AI Gateway accepts a `reasoning` object and maps it to provider-specific controls.
- Its documented normalized effort values include `none`, `minimal`, `low`, `medium`, `high`, and
  `xhigh`; newer provider models can additionally support provider-specific levels such as `max`.
- `GET /v1/models/{model_id}/endpoints` exposes `reasoning` in `supported_parameters`, but does not
  expose the exact effort values accepted by each model.
- Live endpoint checks on 2026-07-12 show `reasoning` on every active endpoint for Claude Sonnet
  4.6, Claude Opus 4.8, GPT-5.6 Sol, GPT-5.6 Terra, and Kimi K2.6. This proves reasoning capability,
  not the model-specific effort enum.
- Source: Context7 `/websites/vercel_ai-gateway`; live
  `https://ai-gateway.vercel.sh/v1/models/{model_id}/endpoints` responses.

## OpenAI API (context7: `/websites/developers_openai_api`) — hosted API

- GPT-5.6 supports reasoning effort from `none` through `max`; the API documentation recommends
  `low`, `medium`, `high`, `xhigh`, and `max` as the user-selectable increasing-effort levels.
- Woven's picker represents “none” separately as its UI-only Off state, so the backend catalog array
  must exclude `none` and publish the selectable levels only.
- Reviewed arrays:
  - `openai/gpt-5.6-sol`: `["low", "medium", "high", "xhigh", "max"]`
  - `openai/gpt-5.6-terra`: `["low", "medium", "high", "xhigh", "max"]`
- The reviewed default effort for both models is `medium`.
- Source: Context7 `/websites/developers_openai_api`, OpenAI latest-model guide.

## Anthropic API (context7: `/anthropics/anthropic-sdk-typescript`) — current hosted API

- Anthropic's model capability type represents `low`, `medium`, `high`, `xhigh`, and `max`
  independently because support varies by model.
- Anthropic's current effort documentation lists `low`, `medium`, and `high` for all supported effort
  models. `max` is available on both Claude Sonnet 4.6 and Claude Opus 4.8. `xhigh` is available on
  Claude Opus 4.8 but not Claude Sonnet 4.6.
- `high` is the API default for both models.
- Reviewed arrays:
  - `anthropic/claude-sonnet-4.6`: `["low", "medium", "high", "max"]`
  - `anthropic/claude-opus-4.8`: `["low", "medium", "high", "xhigh", "max"]`
- Source: Context7 `/anthropics/anthropic-sdk-typescript`; official Anthropic effort docs at
  `https://platform.claude.com/docs/en/build-with-claude/effort`.

## Kimi API Platform — Kimi K2.6 hosted API

- Kimi K2.6 supports thinking and non-thinking modes.
- The official API controls this with `thinking: {"type": "disabled"}` when thinking should be
  turned off. It does not document a granular `reasoning_effort` enum for Kimi K2.6.
- The backend must not invent Low/Medium/High tiers from Gateway's generic `reasoning` parameter.
- Reviewed array:
  - `moonshotai/kimi-k2.6`: `[]`
- A valid empty array means the model can reason but does not expose user-selectable effort tiers.
- Source: official Kimi API docs at `https://platform.kimi.ai/docs/introduction` and
  `https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart`.

## Contract Implications for Woven

- `supports_reasoning` and `supported_reasoning_efforts` are related but not equivalent.
- `supports_reasoning: true` with `supported_reasoning_efforts: []` is valid for a model such as Kimi
  K2.6 that supports thinking but has no documented granular effort control.
- Exact effort arrays belong in reviewed `model_pricing_rules.metadata`; they cannot be recovered
  safely from Gateway's boolean/parameter capability.
- The backend should own `supports_reasoning`, `supported_reasoning_efforts`, and
  `default_reasoning_effort` together. The default must be a member of a non-empty effort array;
  models without granular tiers use `null`.
- Missing or invalid metadata must never trigger a guessed tier list. The backend should safely
  publish `supports_reasoning: false`, an empty effort array, and a `null` default while emitting a
  structured warning. Harness should consume the published values verbatim.
