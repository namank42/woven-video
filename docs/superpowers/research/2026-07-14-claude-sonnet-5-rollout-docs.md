# Docs Digest — Claude Sonnet 5 Hosted Rollout — 2026-07-14

## Anthropic Claude API (context7: `/websites/platform_claude_en`)

- Claude Sonnet 5's Anthropic API model ID is `claude-sonnet-5`.
- Anthropic describes Sonnet 5 as a direct upgrade from Sonnet 4.6.
- The context window is 1,000,000 tokens by default and at maximum. Maximum output is 128,000
  tokens.
- Sonnet 5 supports adaptive thinking and the ordered effort levels `low`, `medium`, `high`,
  `xhigh`, and `max`; `high` is the documented default.
- Adaptive thinking is on by default. Passing manual extended thinking with
  `thinking: { type: "enabled", budget_tokens: N }` returns HTTP 400.
- Non-default `temperature`, `top_p`, or `top_k` values return HTTP 400.
- Sonnet 5 uses a new tokenizer that produces approximately 30% more tokens for the same text than
  Sonnet 4.6. Existing token budgets and measurements should be revisited.
- Introductory pricing through August 31, 2026 is $2.00 per million input tokens and $10.00 per
  million output tokens. Standard pricing afterward is $3.00 input and $15.00 output.
- Sources:
  - [What's new in Claude Sonnet 5](https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5)
  - [Prompting Claude Sonnet 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5)
  - [Introducing Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5)

## Vercel AI Gateway (context7: `/websites/vercel_ai-gateway` plus official Vercel pages)

- The exact Gateway model ID is `anthropic/claude-sonnet-5`.
- Vercel documents Sonnet 5 as available on AI Gateway and shows adaptive thinking with an effort
  value in Anthropic provider options.
- The Gateway model catalog reports a 1M context window.
- The Gateway model catalog reports launch/standard rates of:
  - input: $2.00 / $3.00 per million tokens;
  - output: $10.00 / $15.00 per million tokens;
  - cache read: $0.20 / $0.30 per million tokens; and
  - cache write: $2.50 / $3.75 per million tokens.
- Sources:
  - [Claude Sonnet 5 now available on Vercel AI Gateway](https://vercel.com/changelog/claude-sonnet-5-ai-gateway)
  - [Vercel AI Gateway model catalog](https://vercel.com/ai-gateway/models)

## Woven Contract Derived From Verified Provider Facts

- Woven's existing 20% hosted markup produces introductory public rates through August 31, 2026 of:
  - input: $2.40/M;
  - output: $12.00/M;
  - cache read: $0.24/M; and
  - cache write: $3.00/M.
- Standard public rates beginning September 1, 2026 are:
  - input: $3.60/M;
  - output: $18.00/M;
  - cache read: $0.36/M; and
  - cache write: $4.50/M.
- Hosted settlement remains based on Gateway-reported actual cost plus the existing 20% markup. The
  pricing-page copy must explicitly label the introductory period and its August 31 end date.

## Harness Installed SDK Check

- `woven-harness/Sidecar/package.json` currently installs `@ai-sdk/anthropic` `^3.0.71` and AI SDK
  `^6.0.168`.
- The installed `@ai-sdk/anthropic` 3.0.71 source accepts `low`, `medium`, `high`, `xhigh`, and `max`
  for Anthropic `effort`.
- Harness's current `anthropicEffort` helper narrows the return type to `low | medium | high | xhigh`
  and maps Woven's `max` value to `xhigh`. The coordinated Harness plan should pass `max` through as
  `max` for current adaptive-thinking models so it matches the backend-advertised contract.
