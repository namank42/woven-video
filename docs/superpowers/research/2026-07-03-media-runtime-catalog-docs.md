# Media Runtime Catalog Docs Digest - 2026-07-03

This digest refreshes the provider contract for the media catalog that will be surfaced through
`/api/v1/media/models` and submitted through the hosted media job pipeline. The candidate model list
is `lib/pricing-page-rates.ts`.

## Local SDK Versions

- `@fal-ai/client`: installed at `1.10.1`.
- `@elevenlabs/elevenlabs-js`: installed at `2.55.0`.

## Fal Runtime Contract

The installed Fal client supports the existing queue flow:

- `fal.queue.submit(endpointId, { input, webhookUrl, abortSignal, ... })`
- `fal.queue.status(endpointId, { requestId, logs, abortSignal })`
- `fal.queue.result(endpointId, { requestId, abortSignal })`

`queue.submit` returns a queue status object with `request_id`. `queue.result` returns provider data
under `data`. The current worker shape is therefore valid, but the provider input object must use the
provider-specific field names documented for each endpoint.

## ElevenLabs Music Contract

The installed ElevenLabs SDK supports the current compose call:

- `client.music.compose(request, requestOptions)`

The request body supports:

- `prompt`
- `compositionPlan`
- `musicLengthMs`
- `modelId`
- `outputFormat`
- `seed`
- `forceInstrumental`
- `respectSectionsDurations`
- `storeForInpainting`
- `signWithC2Pa`

For `music_v2`, the public catalog should set `modelId: "music_v2"`. The documented generated-music
duration range is 3 seconds to 5 minutes.

## Catalog Implications

The provider docs require three runtime changes beyond seeding rows:

1. The catalog needs named input asset roles, not only ordered `input_asset_ids`. Real Fal fields are
   endpoint-specific: `image_url`, `image_urls`, `first_frame_url`, `last_frame_url`, `video_url`,
   `start_image_url`, `end_image_url`, `audio_urls`, and similar fields.
2. The public parameter schema needs to express enums, integer ranges, string ranges, array counts,
   and simple cross-field constraints. The current shallow type-only schema is not enough for agents.
3. Pricing/reservation should be parameter-aware for models where cost depends on duration,
   resolution, audio, image count, 4K mode, or web search. Static reservations are not enough for
   production estimates.

## Common Input Roles

Recommended Woven roles for provider input mapping:

| Role | Provider field | Media kind | Cardinality |
| --- | --- | --- | --- |
| `image` | `image_url` | image | exactly 1 |
| `reference_images` | `image_urls` | image | 1..N, endpoint-limited |
| `mask` | `mask_url` | image | 0..1 |
| `first_frame` | `first_frame_url` | image | exactly 1 |
| `last_frame` | `last_frame_url` | image | exactly 1 |
| `start_image` | `start_image_url` | image | exactly 1 |
| `end_image` | `end_image_url` | image | 0..1 or exactly 1, endpoint-dependent |
| `video` | `video_url` | video | exactly 1 |
| `reference_videos` | `video_urls` | video | 0..3 for Seedance reference endpoints |
| `reference_audio` | `audio_urls` | audio | 0..3 for Seedance reference endpoints |

## Candidate Model Contracts

### OpenAI GPT Image 2 on Fal

Sources:

- `https://fal.ai/models/openai/gpt-image-2/api`
- `https://fal.ai/models/openai/gpt-image-2/llms.txt`
- `https://fal.ai/models/openai/gpt-image-2/edit/api`
- `https://fal.ai/models/openai/gpt-image-2/edit/llms.txt`

Endpoints:

| Public model id | Fal endpoint | Kind | Required provider inputs | Output path |
| --- | --- | --- | --- | --- |
| `openai/gpt-image-2` | `openai/gpt-image-2` | image | `prompt` | `images` |
| `openai/gpt-image-2/edit` | `openai/gpt-image-2/edit` | image | `prompt`, `image_urls` | `images` |

Parameters:

- `prompt`: string, required.
- `image_size`: enum or object, default `landscape_4_3`. Enum values include `square_hd`,
  `square`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`, `auto`.
- `quality`: enum `auto`, `low`, `medium`, `high`; default `high`.
- `num_images`: integer 1..4; default 1.
- `output_format`: enum `jpeg`, `png`, `webp`; default `png`.
- `sync_mode`: boolean; default false.
- `mask_url`: optional for edit endpoint.

Pricing basis:

- Provider bills by text and image tokens. Quality and image size materially affect actual cost.
- Woven should use a conservative parameter-aware estimate/reservation rather than treating this as a
  flat per-job price.

### Nano Banana Pro on Fal

Sources:

- `https://fal.ai/models/fal-ai/nano-banana-pro/api`
- `https://fal.ai/models/fal-ai/nano-banana-pro/llms.txt`

Endpoints:

| Public model id | Fal endpoint | Kind | Required provider inputs | Output path |
| --- | --- | --- | --- | --- |
| `fal-ai/nano-banana-pro` | `fal-ai/nano-banana-pro` | image | `prompt` | `images` |

Parameters:

- `prompt`: string, required.
- `num_images`: integer 1..4; default 1.
- `seed`: integer, optional.
- `aspect_ratio`: enum `auto`, `21:9`, `16:9`, `3:2`, `4:3`, `5:4`, `1:1`, `4:5`, `3:4`,
  `2:3`, `9:16`; default `1:1`.
- `output_format`: enum `jpeg`, `png`, `webp`; default `png`.
- `safety_tolerance`: enum string `1`..`6`; default `4`.
- `sync_mode`: boolean; default false.
- `system_prompt`: string; default empty string.
- `resolution`: enum `1K`, `2K`, `4K`; default `1K`.
- `limit_generations`: boolean; default false.
- `enable_web_search`: boolean; default false.

Pricing basis:

- $0.15 per image.
- 4K output is double cost.
- Web search adds $0.015.

Note: this documented endpoint is text-to-image. The pricing page copy says generation/editing, but
the candidate endpoint does not accept image input.

### Nano Banana Lite on Fal

Sources:

- `https://fal.ai/models/fal-ai/nano-banana-lite/api`
- `https://fal.ai/models/fal-ai/nano-banana-lite/llms.txt`
- `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-lite`
- `https://fal.ai/models/fal-ai/nano-banana-lite/edit/api`
- `https://fal.ai/models/fal-ai/nano-banana-lite/edit/llms.txt`
- `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/nano-banana-lite/edit`

Endpoints:

| Public model id | Fal endpoint | Kind | Required provider inputs | Output path |
| --- | --- | --- | --- | --- |
| `fal-ai/nano-banana-lite` | `fal-ai/nano-banana-lite` | image | `prompt` | `images` |
| `fal-ai/nano-banana-lite/edit` | `fal-ai/nano-banana-lite/edit` | image | `prompt`, Woven `reference_images` mapped to `image_urls` | `images` |

Parameters:

- `prompt`: string, required, min length 3, max length 50000.
- `num_images`: integer 1..4; default 1.
- `seed`: integer, optional.
- `aspect_ratio`: enum `auto`, `21:9`, `16:9`, `3:2`, `4:3`, `5:4`, `1:1`, `4:5`, `3:4`,
  `2:3`, `9:16`, `4:1`, `1:4`, `8:1`, `1:8`; default `auto`.
- `output_format`: enum `jpeg`, `png`, `webp`; default `png`.
- `safety_tolerance`: enum string `1`..`6`; default `4`.
- `sync_mode`: boolean; default false.
- `system_prompt`: string; default empty string; max length 50000.
- `limit_generations`: boolean; default true.
- `thinking_level`: optional enum `minimal`, `high`.
- `image_urls`: edit endpoint only; Fal marks it optional, but the Woven catalog should require at
  least one `reference_images` asset for the edit row so the public edit model does not silently act
  like text-to-image.

Pricing basis:

- Fal documents both Lite endpoints as `$1 per units`.
- Woven should model the unit as per generated image for reservation safety: `num_images * $1.00`
  provider cost, then apply the standard 20% hosted markup for a public `$1.20/image` estimate.
- If Fal later clarifies the unit as per request instead of per image, update the seeded formula
  rate without changing the public catalog contract.

### Gemini Omni Flash on Fal

Sources:

- `https://fal.ai/models/fal-ai/gemini-omni-flash/llms.txt`
- `https://fal.ai/models/fal-ai/gemini-omni-flash/image-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/gemini-omni-flash/reference-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/gemini-omni-flash/edit/llms.txt`

Endpoints:

| Public model id | Fal endpoint | Kind | Required provider inputs | Output path |
| --- | --- | --- | --- | --- |
| `fal-ai/gemini-omni-flash` | `fal-ai/gemini-omni-flash` | video | `prompt` | `video` |
| `fal-ai/gemini-omni-flash/image-to-video` | same | video | `prompt`, `image_url` | `video` |
| `fal-ai/gemini-omni-flash/reference-to-video` | same | video | `prompt`, `image_urls` | `video` |
| `fal-ai/gemini-omni-flash/edit` | same | video | `prompt`, `video_url` | `video` |

Parameters:

- `prompt`: string, required.
- `aspect_ratio`: enum `16:9`, `9:16`; default `16:9`.
- `duration`: integer 3..10; default 8.

Pricing basis:

- $1 per generation unit.

### Veo 3.1 on Fal

Sources:

- `https://fal.ai/models/fal-ai/veo3.1/llms.txt`
- `https://fal.ai/models/fal-ai/veo3.1/fast/llms.txt`
- `https://fal.ai/models/fal-ai/veo3.1/image-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/veo3.1/first-last-frame-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/veo3.1/fast/first-last-frame-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/veo3.1/reference-to-video/llms.txt`

Endpoints:

| Public model id | Fal endpoint | Kind | Required provider inputs | Output path |
| --- | --- | --- | --- | --- |
| `fal-ai/veo3.1` | `fal-ai/veo3.1` | video | `prompt` | `video` |
| `fal-ai/veo3.1/fast` | `fal-ai/veo3.1/fast` | video | `prompt` | `video` |
| `fal-ai/veo3.1/image-to-video` | same | video | `prompt`, `image_url` | `video` |
| `fal-ai/veo3.1/fast/image-to-video` | same | video | `prompt`, `image_url` | `video` |
| `fal-ai/veo3.1/first-last-frame-to-video` | same | video | `prompt`, `first_frame_url`, `last_frame_url` | `video` |
| `fal-ai/veo3.1/fast/first-last-frame-to-video` | same | video | `prompt`, `first_frame_url`, `last_frame_url` | `video` |
| `fal-ai/veo3.1/reference-to-video` | same | video | `prompt`, `image_urls` | `video` |

Parameters:

- `prompt`: string, required.
- `aspect_ratio`: enum depends on endpoint. Text and reference endpoints use `16:9`, `9:16`;
  image and first-last endpoints also support `auto`.
- `duration`: enum string `4s`, `6s`, `8s`; default `8s`.
- `negative_prompt`: string, optional.
- `resolution`: enum `720p`, `1080p`, `4k`; default `720p`.
- `generate_audio`: boolean; default true.
- `seed`: integer, optional.
- `auto_fix`: boolean; default true for text endpoints, false for image/reference endpoints.
- `safety_tolerance`: enum string `1`..`6`; default `4`.

Pricing basis:

- Standard: $0.20/sec without audio, $0.40/sec with audio at 720p/1080p. 4K is $0.40/sec
  without audio and $0.60/sec with audio.
- Fast: $0.10/sec without audio, $0.15/sec with audio at 720p/1080p. 4K is $0.30/sec without
  audio and $0.35/sec with audio.

### Seedance 2.0 on Fal

Sources:

- `https://fal.ai/models/bytedance/seedance-2.0/text-to-video/llms.txt`
- `https://fal.ai/models/bytedance/seedance-2.0/image-to-video/llms.txt`
- `https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/llms.txt`
- `https://fal.ai/models/bytedance/seedance-2.0/fast/text-to-video/llms.txt`
- `https://fal.ai/models/bytedance/seedance-2.0/fast/image-to-video/llms.txt`
- `https://fal.ai/models/bytedance/seedance-2.0/fast/reference-to-video/llms.txt`

Endpoints:

| Public model id | Fal endpoint | Kind | Required provider inputs | Output path |
| --- | --- | --- | --- | --- |
| `bytedance/seedance-2.0/text-to-video` | same | video | `prompt` | `video` |
| `bytedance/seedance-2.0/image-to-video` | same | video | `prompt`, `image_url` | `video` |
| `bytedance/seedance-2.0/reference-to-video` | same | video | `prompt`, at least one reference media input | `video` |
| `bytedance/seedance-2.0/fast/text-to-video` | same | video | `prompt` | `video` |
| `bytedance/seedance-2.0/fast/image-to-video` | same | video | `prompt`, `image_url` | `video` |
| `bytedance/seedance-2.0/fast/reference-to-video` | same | video | `prompt`, at least one reference media input | `video` |

Parameters:

- `prompt`: string, required.
- `resolution`: standard enum `480p`, `720p`, `1080p`, `4k`; fast enum `480p`, `720p`.
- `duration`: enum string `4`..`15`; docs also support `auto`. Woven should avoid `auto` if it
  needs exact pre-run estimates.
- `aspect_ratio`: enum `auto`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`; default `auto`.
- `generate_audio`: boolean; default true.
- `bitrate_mode`: enum `standard`, `high`; default `standard`.
- `end_user_id`: string, optional.
- Image-to-video adds `image_url` required and `end_image_url` optional.
- Reference-to-video supports `image_urls` up to 9, `video_urls` up to 3, and `audio_urls` up to 3,
  with a total media limit of 12 files and audio only allowed when at least one image or video is
  also supplied.

Pricing basis:

- Standard 720p: $0.3034/sec.
- Standard 1080p: $0.682/sec.
- Fast 720p: $0.2419/sec.
- Fast reference-to-video with video input: $0.14515/sec.

### Kling Video v3 on Fal

Sources:

- `https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/llms.txt`
- `https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/llms.txt`

Endpoints:

| Public model id | Fal endpoint | Kind | Required provider inputs | Output path |
| --- | --- | --- | --- | --- |
| `fal-ai/kling-video/v3/pro/text-to-video` | same | video | `prompt` or `multi_prompt` | `video` |
| `fal-ai/kling-video/v3/pro/image-to-video` | same | video | `start_image_url`, plus `prompt` or `multi_prompt` | `video` |
| `fal-ai/kling-video/v3/standard/text-to-video` | same | video | `prompt` or `multi_prompt` | `video` |
| `fal-ai/kling-video/v3/standard/image-to-video` | same | video | `start_image_url`, plus `prompt` or `multi_prompt` | `video` |

Parameters:

- `prompt`: string, conditionally required.
- `multi_prompt`: array, conditionally required and mutually exclusive with `prompt`.
- `duration`: enum string `3`..`15`; default `5`.
- `generate_audio`: boolean; default true.
- `shot_type`: enum `customize`, `intelligent`; default `customize`.
- `aspect_ratio`: text endpoints use enum `16:9`, `9:16`, `1:1`; default `16:9`.
- `negative_prompt`: string; default includes low-quality terms.
- `cfg_scale`: number 0..1; default 0.5.
- Image-to-video adds `start_image_url` required, `end_image_url` optional, and advanced
  `elements` support.

Pricing basis:

- Pro: $0.112/sec without audio, $0.168/sec with audio, $0.196/sec with voice control.
- Standard: $0.084/sec without audio, $0.126/sec with audio, $0.154/sec with voice control.

### ElevenLabs Music v2

Sources:

- `https://elevenlabs.io/docs/api-reference/music/compose`
- `https://elevenlabs.io/docs/overview/capabilities/music`

Catalog id:

| Public model id | Provider | Kind | Required inputs | Output |
| --- | --- | --- | --- | --- |
| `music_v2` | ElevenLabs | audio | `prompt` or `compositionPlan` | audio bytes |

Parameters:

- `prompt`: string.
- `compositionPlan`: object.
- `musicLengthMs`: integer 3000..600000.
- `modelId`: should be fixed to `music_v2`.
- `outputFormat`: string enum from ElevenLabs formats; default for v2 is MP3 48 kHz 192 kbps.
- `seed`: integer, optional.
- `forceInstrumental`: boolean, optional.
- `respectSectionsDurations`: boolean, optional.
- `storeForInpainting`: boolean, optional.
- `signWithC2Pa`: boolean, optional.

Pricing basis:

- The pricing table currently models this as a music generation row. Runtime estimates should use the
  app's configured music duration-based price policy.
