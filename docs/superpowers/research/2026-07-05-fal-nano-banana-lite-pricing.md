# Docs Digest - Fal Nano Banana Lite Pricing - 2026-07-05

## Fal Nano Banana 2 Lite pricing and endpoints
- Latest text-to-image endpoint: `google/nano-banana-2-lite`.
- Latest edit/image-input endpoint: `google/nano-banana-2-lite/edit`.
- The text-to-image docs list token pricing: text input `$0.3125 / 1M`, text output `$1.875 / 1M`, image input `$0.3125 / 1M`, image output `$37.50 / 1M`; output images are fixed at `1K (1024x1024px)`.
- The edit endpoint accepts `image_urls` for image-to-image generation/editing. Its `llms.txt` currently says `$0 per compute seconds`, but the model family pricing should still be modeled from output image cost unless Fal usage records prove otherwise.
- Fal's pricing page lists `Nanobanana` as image pricing at `$0.0398`; this matches roughly `1061 image-output tokens * $37.50 / 1,000,000`.
- For Woven's hosted markup of 20%, the public per-image charge should be `$0.04776`.
- Legacy endpoints `fal-ai/nano-banana-lite` and `fal-ai/nano-banana-lite/edit` should be replaced in the runtime catalog.
- Source: https://fal.ai/models/google/nano-banana-2-lite/llms.txt
- Source: https://fal.ai/models/google/nano-banana-2-lite/edit/llms.txt
- Source: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/nano-banana-2-lite
- Source: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=google/nano-banana-2-lite/edit
- Source: https://fal.ai/pricing
