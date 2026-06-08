---
name: loops-campaign
description: Create an email marketing campaign in Loops via the Content API — creates the campaign, writes the email body in LMX, and sets subject/preview/sender, leaving it as a draft for audience selection and sending in the Loops dashboard. Use this whenever the user wants to draft, build, or set up a Loops campaign, send an announcement or marketing email to their users (e.g. "email my canvas users about X", "announce the new editor", "draft a campaign in Loops", "new product email blast"), or asks about Loops lists, audiences, contact properties, or LMX email formatting. Trigger even if the user doesn't say the word "campaign" — any request to compose and send a broadcast email to a user segment in Loops applies.
---

# Loops Campaign

Create email marketing campaigns in Loops (loops.so) through the Content API, then hand off to the dashboard for audience targeting and sending.

## What the API can and can't do

This is the single most important thing to understand before starting, because it shapes the whole workflow:

**The API CAN:** create a campaign (as a draft), and set the email's subject, preview text, sender fields, and body (in LMX).

**The API CANNOT:** set the campaign audience, or send/schedule the campaign. There is no endpoint for either. `update-campaign` only changes the campaign's `name`.

So the workflow always ends at a **draft**. The user finishes in the dashboard: picks the audience, sends a test, and sends. This is also the right safety boundary — sending a broadcast to a whole user segment is high blast-radius and irreversible, so never try to automate the send even if one becomes available. Stop at the draft and hand off.

## Setup

- **Base URL:** `https://app.loops.so/api/v1`
- **Auth:** `Authorization: Bearer $LOOPS_API_KEY`. In this repo the key lives in `.env.prod` as `LOOPS_API_KEY`. Load it with `set -a; source .env.prod; set +a` rather than printing it.
- The **Content API must be enabled** for the team, or campaign/email-message calls return `401`. (Contact endpoints work regardless.)
- Rate limit: 10 req/s per team. The Content API is in open alpha and may change — if a call shapes differently than documented, fetch the current docs at `https://loops.so/docs/llms.txt` and the linked endpoint pages.

## Workflow

### 1. Write the email copy first

Don't jump to the API. Get the copy right with the user — subject, preview, body, sender, CTA. See "Writing the email" below for the voice/structure principles that work for this audience. Only build the draft once the words are settled (or the user explicitly wants a rough draft to edit in the editor).

### 2. Create the campaign

```bash
set -a; source .env.prod; set +a
curl -s -X POST https://app.loops.so/api/v1/campaigns \
  -H "Authorization: Bearer $LOOPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Woven Editor announcement"}'
```

The response includes the three IDs you need next:
- `campaignId` — the dashboard URL is `https://app.loops.so/campaigns/{campaignId}`
- `emailMessageId` — the target of the content update
- `emailMessageContentRevisionId` — pass as `expectedRevisionId` in the next call

### 3. Set subject, sender, and body

Build the body as **LMX** (Loops Markup Language — not HTML or plain text). See `references/lmx.md` for the syntax. Put the JSON in a file to avoid shell-escaping the LMX, then:

```bash
set -a; source .env.prod; set +a
curl -s -X POST https://app.loops.so/api/v1/email-messages/{emailMessageId} \
  -H "Authorization: Bearer $LOOPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/loops_email.json
```

Where `/tmp/loops_email.json` is:

```json
{
  "expectedRevisionId": "<emailMessageContentRevisionId from step 2>",
  "subject": "Canvas wasn't the right tool",
  "previewText": "meet the video editor you can talk to",
  "fromName": "Naman from Woven",
  "fromEmail": "naman",
  "replyToEmail": "naman@woven.video",
  "lmx": "<Paragraph>...</Paragraph><Button href=\"https://woven.video\">Try it here</Button>"
}
```

Field notes:
- `fromEmail` is the **username only** — Loops appends the verified sending domain (here `mail.woven.video`), so recipients see `naml@mail.woven.video`. Keep `replyToEmail` as the clean address (`naman@woven.video`) so replies land in a real inbox.
- Loops auto-applies the team's theme styling, so you don't need a `<Style>` tag unless you want overrides.
- You don't need a greeting or sign-off unless the user wants one — but a personal sign-off (`— Naman`) suits founder-voice announcements.

### 4. Updating the draft after the user edits it in the dashboard

If the user has opened the email in the Loops editor and made changes, your saved `expectedRevisionId` is stale and a blind update will `409`. **Worse, an API push overwrites their editor edits.** So before re-pushing:

```bash
set -a; source .env.prod; set +a
curl -s https://app.loops.so/api/v1/email-messages/{emailMessageId} \
  -H "Authorization: Bearer $LOOPS_API_KEY"
```

Read the current `contentRevisionId` and `lmx` from the response. Use that revision id as the new `expectedRevisionId`, and reconcile your changes against the current `lmx` so you don't clobber their work. When in doubt about who has the latest, ask the user whether they're editing in the dashboard or want you to push — don't silently overwrite.

### 5. Hand off

Give the user the dashboard link and the remaining manual steps:
1. Open `https://app.loops.so/campaigns/{campaignId}`
2. Set the audience (see below).
3. Send a **test** to themselves to check rendering and links.
4. Send.

## Audiences

Loops has **no tags**. It segments two ways:

- **Mailing lists:** `GET /v1/lists` → `[{id, name, description, isPublic}]`
- **Contact properties:** `GET /v1/contacts/properties` (add `?list=custom` for only custom fields). Useful segmentation fields here include `userGroup`, `plan`, `source`, and `subscribed`.

The user sets the audience filter in the dashboard using these — you can't set it via API.

**Computing list overlap / counts:** there is **no API to enumerate or count contacts on a list** (`find-contact` is one email at a time; bulk export is dashboard-only). So if the user wants e.g. "how many Canvas users are also Editor users," have them export both lists to CSV from the dashboard, then diff on email locally. Don't promise an API-driven overlap count.

## Writing the email

Durable principles for marketing/announcement copy to this user base (founder-to-user, warm, honest):

- **Subject + preview as a one-two punch.** Subject opens a loop, preview pays it off — they should not repeat each other. e.g. subject "Canvas wasn't the right tool" + preview "meet the video editor you can talk to."
- **Subject specificity beats hype.** Vague "A huge update" / "huge news" subjects get skipped. A specific or mildly vulnerable subject ("Canvas wasn't the right tool") earns opens. Avoid category swipes ("editors are stuck in 2009") — they read like every startup.
- **Sender name carries brand recognition.** A personal name alone may not be recognized in the inbox; "Naman from Woven" gets the founder voice *and* the brand. The sender name is the biggest lever on open rate.
- **Lead with what it does, in plain words.** State the core value outright rather than implying it — if the product does the work for the user, say so ("describe what you want and it edits your videos for you"), don't make them infer it from feature lists.
- **Concrete verbs over jargon.** "edits"/"cuts" beats "makes" (which sounds like generative text-to-video); drop techy words like "natively" unless the user wants them.
- **Vary sentence openers.** Watch for three sentences in a row starting with "It" — break the run with a different opener.
- **Keep it lean.** ~100–150 words is the sweet spot for an announcement; don't pad, and only cut secondary features if the user wants it shorter.
- **Match punctuation to the user's stated preference** (e.g. some users dislike em dashes — confirm and stay consistent).

Treat these as starting heuristics, not rules — the user's voice wins, so iterate the copy with them.
