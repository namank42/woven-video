# Reel Caption Generation

This document defines the v1 plan for generating captions for Woven reel projects from the desktop editor.

## Product Behavior

The editor exposes caption generation as a user action:

- `Generate captions` when a reel has no generated captions yet.
- `Update captions` when existing captions are stale after timeline/audio edits.

Captions remain generated state in v1. The user can move or trim the caption layer visibility range in the timeline, but Woven should not introduce per-word editing, caption-page splitting, or independent page dragging yet. Designed text belongs in text overlays; captions are derived from the reel's spoken audio.

## Source Of Truth

The desktop editor owns the local reel project files:

- `spec.json`
- `voiceover.wav`
- `captions.json`
- `clip-boundaries.json`

The cloud backend does not become the permanent source of truth for reel media. It only processes temporary audio and returns caption tokens. The desktop sidecar writes the final `captions.json` beside the reel `spec.json`.

## End-To-End Flow

1. User clicks `Generate captions` or `Update captions`.
2. Woven Harness saves pending `spec.json` edits.
3. The sidecar rebuilds `voiceover.wav` locally from the current primary timeline.
4. The sidecar encodes the voiceover to a compact speech-friendly upload format, such as mono `m4a` or `mp3`.
5. The sidecar creates a caption job through Woven Cloud.
6. The sidecar uploads audio directly to temporary object storage using a signed upload URL.
7. A worker sends the audio to ElevenLabs Scribe v2.
8. The worker normalizes ElevenLabs output into Woven caption tokens.
9. Woven Cloud settles billing and marks the job complete.
10. The sidecar downloads or receives the caption token JSON.
11. The sidecar writes `captions.json`, runs local postprocess if needed, reloads captions, and refreshes preview.

## Cloud API

Use the existing Woven API base:

- `POST /api/v1/reel-captions/jobs`
- `GET /api/v1/reel-captions/jobs/:id`
- Optional: `POST /api/v1/reel-captions/jobs/:id/cancel`

All routes require the same Woven/Supabase bearer token used by hosted model billing.

The create route should:

1. Validate auth.
2. Validate requested duration and file metadata.
3. Estimate final user charge.
4. Create a `generation_jobs` row.
5. Reserve prepaid balance.
6. Return a job ID plus signed upload URL.

The status route should return compact job state:

- `queued`
- `uploaded`
- `transcribing`
- `postprocessing`
- `succeeded`
- `failed`
- `cancelled`

On success, the response should include the normalized captions or a short-lived signed download URL for the captions JSON.

## Provider

V1 uses ElevenLabs Scribe v2.

Default settings:

- No keyterm prompting.
- No entity detection.
- No diarization.
- No realtime transcription.
- Batch/pre-recorded transcription only.
- Preserve word-level timestamps.

The backend must keep the provider behind a Woven-owned adapter so the desktop app never calls ElevenLabs directly and no ElevenLabs API key ships in the app.

## Caption Format

Normalize provider output to the existing Remotion-compatible caption token shape:

```json
[
  {
    "text": "word",
    "startMs": 120,
    "endMs": 260,
    "timestampMs": 120,
    "confidence": 0.98
  }
]
```

`timestampMs` should match `startMs` unless the provider gives a better midpoint-style timestamp. `confidence` may be `null` if unavailable.

The desktop sidecar remains responsible for writing this as `captions.json` in the reel folder.

## Pricing

Public price:

- `$0.01` per audio minute.
- `$0.01` minimum per generation.
- Bill by voiceover duration, rounded up to the nearest billable second.
- Failed or cancelled jobs are not charged.

Recommended final charge formula:

```text
max(10_000, ceil(duration_seconds * 10_000 / 60))
```

Values are in `usd_micros`, where `$0.01 = 10_000`.

The pricing page should list this under a media feature section:

| Feature | Price | Notes |
| --- | ---: | --- |
| Auto captions | `$0.01/min` | `$0.01 minimum`, billed by voiceover duration |

## Billing

Reuse the existing prepaid balance model described in `docs/billing-architecture.md`.

The backend should record:

- estimated charge in `generation_jobs.estimated_cost_usd_micros`
- reserved charge via `reserve_balance`
- final charge via `settle_balance_reservation`
- released reservation via `release_balance_reservation` on failure/cancel
- provider raw cost in `usage_events`
- Woven charged amount in `usage_events`
- markup amount in `usage_events`

Usage metadata should include:

- `provider`: `elevenlabs`
- `model`: `scribe_v2`
- `operation`: `reel_captions`
- `duration_seconds`
- `provider_job_id` or request ID if available
- temporary storage object key
- output token count

Account and usage UI should show this as `Auto captions`, not `reel_captions`.

## Vercel Cost Boundary

Do not proxy audio uploads through Vercel API routes.

Vercel should handle only control-plane JSON requests:

- job creation
- signed upload URL creation
- status polling
- billing settlement callbacks

Audio should move directly between the desktop app, temporary object storage, and the transcription worker/provider. This avoids function body limits and prevents Vercel bandwidth/function duration from becoming the main cost center.

## Storage Policy

Temporary audio is not a permanent user artifact.

Storage behavior:

- Store uploaded audio under a user/job-scoped temporary key.
- Keep temporary audio private.
- Delete audio after job completion or failure.
- Add a cleanup fallback for abandoned jobs, ideally 1-24 hours.
- Keep permanent captions local in the user's reel folder.

The cloud may retain small metadata needed for billing and audit, but not the source audio unless a future debugging mode explicitly allows it.

## Desktop Integration

Woven Harness sidecar responsibilities:

1. Save pending `spec.json`.
2. Run the existing local voiceover rebuild path.
3. Create the cloud caption job.
4. Upload encoded voiceover audio to the signed URL.
5. Ask the cloud job to process the uploaded audio.
6. Write returned `captions.json` locally.
7. Reload captions and refresh preview/cache.

The v1 route is synchronous after upload: the backend signs a short-lived
storage URL and passes that URL to ElevenLabs Scribe v2, so Vercel does not
relay the audio bytes. A queue/polling worker can replace the synchronous
process endpoint later without changing the desktop upload contract.
Local Supabase development URLs are not reachable by ElevenLabs, so local dev
may fall back to a backend file upload while production keeps provider-side
fetching from signed storage.

Editor UI states:

- `Building voiceover`
- `Uploading audio`
- `Generating captions`
- `Applying captions`
- `Captions updated`
- `Caption generation failed`

On failure, keep existing captions if present and expose retry.

## Stale Rules

Mark captions stale when edits affect spoken timing or source audio:

- primary clip add/remove/reorder
- primary clip move/split/trim
- transition timing that shifts the primary timeline
- primary clip mute/unmute when voiceover is built from clips
- primary clip volume if used during voiceover generation
- voiceover replace/move/trim/delete

Do not mark captions stale for:

- b-roll
- image overlays
- text overlays
- music
- SFX
- caption style changes
- caption visibility range changes

## Implementation Order

1. Add pricing rule and public pricing page entry in `woven-video`.
2. Add backend job API and billing reservation/settlement path.
3. Add ElevenLabs Scribe v2 worker adapter and caption normalization.
4. Add temporary storage upload and signed-provider-read flow.
5. Add Woven Harness sidecar caption rebuild endpoint.
6. Add editor UI action and progress states.
7. Add stale flag wiring and preview reload behavior.
8. Add tests and run one end-to-end reel validation.

## Validation Checklist

- A 30-second reel charges `$0.01`.
- A 90-second reel charges `$0.015`.
- Failed jobs release reserved balance.
- Existing captions remain intact if regeneration fails.
- Returned captions match the local Remotion caption token shape.
- Generated `captions.json` loads in the editor preview.
- Timeline edits that affect spoken timing mark captions stale.
- Non-spoken visual edits do not mark captions stale.
- No audio file is uploaded through a Vercel API request body.
