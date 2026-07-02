# Docs Digest - Hosted Media Model Candidates - 2026-07-01

## Local SDKs
- `@fal-ai/client` is installed at `^1.10.1`.
- `@elevenlabs/elevenlabs-js` is installed at `^2.55.0`.
- No first-party OpenAI or Google media SDK is currently installed for the hosted media worker path.

## OpenAI GPT Image
- Current OpenAI image generation docs use `gpt-image-2` as the primary example for `images.generate`.
- GPT Image models requiring org verification include `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`.
- The Image API has generation and edit endpoints for `gpt-image-1` and later models. The variations endpoint is only called out for models that support it, such as DALL-E 2, so do not model GPT Image "variants" as the old variations endpoint.
- `gpt-image-2` supports arbitrary valid sizes up to 3840px max edge, with common sizes including 1024x1024, 1536x1024, 1024x1536, 2048x2048, 2048x1152, 3840x2160, and 2160x3840.
- OpenAI pricing docs list `gpt-image-2`, `gpt-image-1.5`, and `gpt-image-1-mini`; `gpt-image-2` has image/text token pricing and a request-cost table in the image guide.
- Sources:
  - https://developers.openai.com/api/docs/guides/image-generation
  - https://developers.openai.com/api/docs/models
  - https://developers.openai.com/api/docs/pricing

## Google Nano Banana / Gemini Image
- Google's Gemini API image page names four Nano Banana models:
  - `gemini-3.1-flash-lite-image`: Nano Banana 2 Lite, fastest and cheapest, not the frontier pick.
  - `gemini-3.1-flash-image`: Nano Banana 2, the general workhorse with 4K generation, world knowledge, reliable text rendering, multiple reference images, and consistency.
  - `gemini-3-pro-image`: Nano Banana Pro, premium model for complex visual tasks, world knowledge, localization, brand consistency, and precision control.
  - `gemini-2.5-flash-image`: original Nano Banana, now legacy; Google recommends moving to Nano Banana 2 Lite.
- The Interactions API is recommended by Google for latest features and models.
- Image generation/editing examples use `gemini-3.1-flash-image`, including text-to-image and text-plus-image-to-image flows.
- Sources:
  - https://ai.google.dev/gemini-api/docs/image-generation

## Google Video
- Google's Gemini API video overview says the Gemini API offers two video generation models:
  - Gemini Omni Flash: recommended default for video generation; better coherence, multi-input reasoning, character consistency, factual accuracy, and multi-turn conversational editing.
  - Veo 3.1: use for specific capabilities like scene extension, last-frame control, native audio, and image-based direction through `generateContent`.
- Gemini Omni Flash official model id is `gemini-omni-flash-preview`; it is still preview in the Gemini API. Google's docs price it at an effective about $0.10/sec for 720p Standard video output. It supports text-to-video, image-to-video, reference-to-video, and conversational video edits, but does not support video extension or first-last-frame interpolation.
- Source:
  - https://ai.google.dev/gemini-api/docs/video
  - https://ai.google.dev/gemini-api/docs/omni
  - https://ai.google.dev/gemini-api/docs/pricing

## Fal Video/Image Endpoints
- Fal queue docs on model pages use `fal.queue.submit`, `fal.queue.status`, and `fal.queue.result`; this matches the existing media worker adapter.
- Fal hosted file URL guidance allows passing public hosted URLs, which matches Woven signed media URLs.
- Nano Banana:
  - `fal-ai/nano-banana`: Gemini 2.5 Flash Image, original/legacy Nano Banana text-to-image.
  - `fal-ai/nano-banana/edit`: original/legacy Nano Banana image editing; accepts `image_urls`.
  - `fal-ai/nano-banana-pro`: current Nano Banana Pro/2 fal endpoint; supports `resolution` values `1K`, `2K`, `4K`, web search, and image generation outputs.
- GPT Image:
  - `openai/gpt-image-2`: GPT Image 2 text-to-image through fal; supports flexible sizes up to 4K, quality, multiple output formats, and output image URLs.
  - `openai/gpt-image-2/edit`: GPT Image 2 image editing through fal; accepts `image_urls` and optional `mask_url`.
  - Fal also documents `fal-ai/gpt-image-1.5`; use this only as a fallback/cheaper non-frontier option.
- Veo 3.1:
  - `fal-ai/veo3.1`
  - `fal-ai/veo3.1/fast`
  - `fal-ai/veo3.1/image-to-video`
  - `fal-ai/veo3.1/fast/image-to-video`
  - `fal-ai/veo3.1/first-last-frame-to-video`
  - `fal-ai/veo3.1/fast/first-last-frame-to-video`
  - `fal-ai/veo3.1/reference-to-video`
  - `fal-ai/veo3.1/extend-video`
  - `fal-ai/veo3.1/fast/extend-video`
- Gemini Omni Flash:
  - `fal-ai/gemini-omni-flash`: text-to-video with audio. Inputs are `prompt`, optional `aspect_ratio` (`16:9` or `9:16`), optional `duration` from 3 to 10 seconds. Output is `video`.
  - `fal-ai/gemini-omni-flash/image-to-video`: image-to-video with audio. Inputs are `prompt`, `image_url`, optional `aspect_ratio`, optional `duration` from 3 to 10 seconds. Output is `video`.
  - `fal-ai/gemini-omni-flash/reference-to-video`: reference-image video with audio. Inputs are `prompt`, `image_urls`, optional `aspect_ratio`, optional `duration` from 3 to 10 seconds. Output is `video`.
  - `fal-ai/gemini-omni-flash/edit`: video-to-video edit. Inputs are `prompt` and `video_url`. Output is `video`.
  - Fal docs list pricing as `$1 per units`; implementation should confirm how Fal bills a "unit" before final credit pricing, because Google's first-party docs list Omni Flash at about $0.10/sec effective output cost.
- Seedance 2.0:
  - `bytedance/seedance-2.0/text-to-video`
  - `bytedance/seedance-2.0/image-to-video`
  - `bytedance/seedance-2.0/reference-to-video`
  - `bytedance/seedance-2.0/fast/text-to-video`
  - `bytedance/seedance-2.0/fast/image-to-video`
  - `bytedance/seedance-2.0/fast/reference-to-video`
- Kling v3 (preferred for curated frontier list):
  - `fal-ai/kling-video/v3/pro/text-to-video`
  - `fal-ai/kling-video/v3/pro/image-to-video`
  - `fal-ai/kling-video/v3/standard/text-to-video`
  - `fal-ai/kling-video/v3/standard/image-to-video`
- Exact Fal field map for curated endpoints:

| Endpoint | Input fields | Output field |
| --- | --- | --- |
| `openai/gpt-image-2` | `prompt`, `image_size`, `quality`, `num_images`, `output_format`, `sync_mode` | `images` |
| `openai/gpt-image-2/edit` | `prompt`, `image_urls`, `image_size`, `quality`, `num_images`, `output_format`, `sync_mode`, `mask_url` | `images` |
| `fal-ai/nano-banana-pro` | `prompt`, `num_images`, `seed`, `aspect_ratio`, `output_format`, `safety_tolerance`, `sync_mode`, `system_prompt`, `resolution`, `limit_generations`, `enable_web_search` | `images`, `description` |
| `fal-ai/gemini-omni-flash` | `prompt`, `aspect_ratio`, `duration` | `video` |
| `fal-ai/gemini-omni-flash/image-to-video` | `prompt`, `image_url`, `aspect_ratio`, `duration` | `video` |
| `fal-ai/gemini-omni-flash/reference-to-video` | `prompt`, `image_urls`, `aspect_ratio`, `duration` | `video` |
| `fal-ai/gemini-omni-flash/edit` | `prompt`, `video_url` | `video` |
| `fal-ai/veo3.1` | `prompt`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/fast` | `prompt`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/image-to-video` | `prompt`, `image_url`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/fast/image-to-video` | `prompt`, `image_url`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/first-last-frame-to-video` | `prompt`, `first_frame_url`, `last_frame_url`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/fast/first-last-frame-to-video` | `prompt`, `first_frame_url`, `last_frame_url`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/reference-to-video` | `prompt`, `image_urls`, `aspect_ratio`, `duration`, `resolution`, `generate_audio`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/extend-video` | `prompt`, `video_url`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `fal-ai/veo3.1/fast/extend-video` | `prompt`, `video_url`, `aspect_ratio`, `duration`, `negative_prompt`, `resolution`, `generate_audio`, `seed`, `auto_fix`, `safety_tolerance` | `video` |
| `bytedance/seedance-2.0/text-to-video` | `prompt`, `resolution`, `duration`, `aspect_ratio`, `generate_audio`, `bitrate_mode`, `end_user_id` | `video`, `seed` |
| `bytedance/seedance-2.0/image-to-video` | `prompt`, `image_url`, `end_image_url`, `resolution`, `duration`, `aspect_ratio`, `generate_audio`, `bitrate_mode`, `end_user_id` | `video`, `seed` |
| `bytedance/seedance-2.0/reference-to-video` | `prompt`, `image_urls`, `video_urls`, `audio_urls`, `resolution`, `duration`, `aspect_ratio`, `generate_audio`, `bitrate_mode`, `end_user_id` | `video`, `seed` |
| `bytedance/seedance-2.0/fast/text-to-video` | `prompt`, `resolution`, `duration`, `aspect_ratio`, `generate_audio`, `bitrate_mode`, `end_user_id` | `video`, `seed` |
| `bytedance/seedance-2.0/fast/image-to-video` | `prompt`, `image_url`, `end_image_url`, `resolution`, `duration`, `aspect_ratio`, `generate_audio`, `bitrate_mode`, `end_user_id` | `video`, `seed` |
| `bytedance/seedance-2.0/fast/reference-to-video` | `prompt`, `image_urls`, `video_urls`, `audio_urls`, `resolution`, `duration`, `aspect_ratio`, `generate_audio`, `bitrate_mode`, `end_user_id` | `video`, `seed` |
| `fal-ai/kling-video/v3/pro/text-to-video` | `prompt`, `duration`, `multi_prompt`, `generate_audio`, `shot_type`, `aspect_ratio`, `negative_prompt`, `cfg_scale` | `video` |
| `fal-ai/kling-video/v3/pro/image-to-video` | `prompt`, `multi_prompt`, `start_image_url`, `duration`, `generate_audio`, `end_image_url`, `elements`, `shot_type`, `negative_prompt`, `cfg_scale` | `video` |
| `fal-ai/kling-video/v3/standard/text-to-video` | `prompt`, `duration`, `multi_prompt`, `generate_audio`, `shot_type`, `aspect_ratio`, `negative_prompt`, `cfg_scale` | `video` |
| `fal-ai/kling-video/v3/standard/image-to-video` | `prompt`, `multi_prompt`, `start_image_url`, `duration`, `generate_audio`, `end_image_url`, `elements`, `shot_type`, `negative_prompt`, `cfg_scale` | `video` |
- Sources:
  - https://fal.ai/models/fal-ai/nano-banana/api
  - https://fal.ai/models/fal-ai/nano-banana/edit/api
  - https://fal.ai/models/fal-ai/nano-banana-pro/api
  - https://fal.ai/models/openai/gpt-image-2/api
  - https://fal.ai/models/openai/gpt-image-2/edit/api
  - https://fal.ai/gpt-image-2
  - https://fal.ai/seedance-2.0
  - https://fal.ai/models/fal-ai/veo3.1
  - https://fal.ai/models/fal-ai/gemini-omni-flash/llms.txt
  - https://fal.ai/models/fal-ai/gemini-omni-flash/image-to-video/llms.txt
  - https://fal.ai/models/fal-ai/gemini-omni-flash/reference-to-video/llms.txt
  - https://fal.ai/models/fal-ai/gemini-omni-flash/edit/llms.txt
  - https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video/llms.txt
  - https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/llms.txt
  - https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video/llms.txt
  - https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/llms.txt

## ElevenLabs Music
- Music compose endpoint is `POST https://api.elevenlabs.io/v1/music`.
- `model_id` enum values are `music_v1` and `music_v2`; API default is still `music_v1` during transition, but docs say Music v2 is the new UI default and next generation model.
- Prompt generation supports `prompt`, `music_length_ms` from 3000 to 600000 ms, `force_instrumental`, `seed`, and output format.
- Composition plans differ by model: `music_v1` uses section plans; `music_v2` uses chunk-based composition plans. Music v2 enforces chunk durations.
- Eleven Music key facts say Music v2 improves prompt adherence, composition, prompt understanding, multilingual output, long-form section-by-section composition, mid-track genre transitions, complex vocal delivery, improved inpainting, and embedded sound effects.
- Generated music duration range is 3 seconds to 5 minutes.
- ElevenLabs pricing page says Eleven Music costs approximately 900 ElevenLabs credits per minute. Public Woven USD pricing should use the effective cost of Woven's ElevenLabs account credits plus the standard hosted-media markup.
- Sources:
  - https://elevenlabs.io/docs/api-reference/music/compose
  - https://elevenlabs.io/docs/overview/capabilities/music
  - https://elevenlabs.io/pricing

## Fal Pricing Notes For Public Pricing Page
- GPT Image 2 and GPT Image 2 edit: Fal prices text tokens at $5.00/M input, $1.25/M cached, $10.00/M output; image tokens at $8.00/M input, $2.00/M cached, $30.00/M output. Quality materially changes cost.
- Nano Banana Pro: $0.15 per standard image. 4K outputs are double. Web search adds $0.015.
- Gemini Omni Flash text/image/reference/edit: Fal docs currently say "$1 per units"; verify actual unit meaning before final public pricing if listing as a precise USD rate.
- Veo 3.1: 720p/1080p costs $0.20/sec without audio or $0.40/sec with audio; 4K costs $0.40/sec without audio or $0.60/sec with audio.
- Veo 3.1 Fast: 720p/1080p costs $0.10/sec without audio or $0.15/sec with audio; 4K costs $0.30/sec without audio or $0.35/sec with audio.
- Seedance 2.0: 720p costs $0.3034/sec and 1080p costs $0.682/sec. Fal also describes token-based pricing for 480p/720p/1080p/4K; the public table should use simple representative "from" pricing unless backend exposes a full estimator.
- Seedance 2.0 Fast: 720p costs $0.2419/sec. Fal also describes token-based pricing; use simple representative "from" pricing unless backend exposes a full estimator.
- Kling v3 Pro: $0.112/sec audio off, $0.168/sec audio on, $0.196/sec with voice control while generating audio.
- Kling v3 Standard: $0.084/sec audio off, $0.126/sec audio on, $0.154/sec with voice control while generating audio.
- All public Woven-hosted prices should apply the Woven markup configured for the model, currently expected to be 20% for hosted media.
