# Consumer AI-answer pilot — September 8, 2026

## Scope and result

Ten fixed questions across ChatGPT Search, Perplexity Search, Grok, Google AI Overviews and Google AI Mode. This is one observation per question and surface, not a ranking probability or demand estimate. The selected questions are in validated-shortlist.json.

No Woven brand mention was found in any completed captured answer, and no woven.video link was found among the visible links captured. This is evidence of a visibility gap in this sample, not proof Woven is never recommended.

## Completion scorecard

| Surface | Completed answers | Missing | Woven mentions |
|---|---:|---:|---:|
| ChatGPT Search | 10 | 0 | 0 |
| Perplexity website | 9 | 1 free-search limit | 0 |
| Grok | 4 | 6 weekly-limit | 0 |
| Google AI Overviews | 10 | 0 | 0 |
| Google AI Mode | 10 | 0 | 0 |
| Total | 43 | 7 | 0 |

All 50 question/surface cells are retained; seven blocked cells are excluded from mention rates. The final ChatGPT answer was recovered after dismissing its temporary throttle notice, with completed response actions visible. No further retry is needed for that cell.

## What the answers suggest

- Broad short-form and TikTok prompts favor CapCut. Shorts prompts often produce long-to-short clippers such as OpusClip: generation and repurposing are different intents.
- Script-to-video prompts produce distinct answers: ChatGPT favors InVideo AI overall, Grok discusses Fliki for narrated footage, and Google Overview leads with Synthesia. Avatar/presenter intent competes with the workflow Woven actually offers.
- Chat-driven editing is a recognizable category: answers name Descript/Underlord, Kapwing/Kai, Async, Riverside, ChatCut and Captions. Woven is absent even from this closely aligned question.
- Mac questions name established editors; Mac compatibility alone is unlikely to distinguish the offer in these answers.
- Google links heavily to YouTube demonstrations, while ChatGPT often links to official feature pages. This supports testing both clear product documentation and independently useful demonstrations, not only publishing generic comparison copy.

## Method and limits

- ChatGPT used new Temporary Chat tabs, the visible Unpersonalized setting and Web search selected before the exact prompt. Grok used Private Chat with Fast displayed. Perplexity used incognito Search. Backend model identities were not independently verified.
- Google was signed in. URLs requested English and US results, but the interface revealed Taiwan location/past activity on an initial query. AI Mode used Try without personalization/peek_pws=0. This is NOT a controlled US-localized baseline; URL parameters do not erase location effects.
- Same-URL navigation retained history in some early attempts. Follow-up attempts were excluded; subsequent questions used separate tabs with empty-conversation checks. The first two Grok questions were captured before the retained-history problem affected a later follow-up.
- Visible answer text and links are retained in consumer-pilot-raw.json. Captured links can include source cards or UI links; they are not an exhaustive audited list of inline citations. Perplexity collapsed citations may expose a domain label without a captured destination. Grok Q081 does not retain a separate link array.
- Competitor feature, pricing and quality claims are model outputs, not fact-checked recommendations from us.
- Rate-limit responses are missing data and excluded from the answer denominator. Grok reported its weekly limit, resetting September 11. Perplexity reached its free-search limit, resetting in a few hours. No upgrades were purchased. ChatGPT's temporary throttle was checked separately.
- No DataForSEO or other paid API calls were made for this consumer-browser pilot. It used existing accounts and their quotas; agent usage/time is separate.

## Recommended next work

1. Make a real input-to-export demo for the script-to-video and chat-editing workflows, recording actual constraints and output quality.
2. Use those artifacts to improve /for/reels and support /script-to-video and /edit-videos-by-chatting, reusing the page plan rather than creating one page per prompt.
3. Use the citation evidence to identify specific tutorials and comparisons where an honest hands-on evaluation of Woven would be relevant. No outreach has been sent.
4. Fill the missing platform/question cells when account quotas permit. Before broadening to all 34 destinations, use queued scraping for scale plus a smaller consumer-browser panel; retain separate measurement labels and controlled geography where possible.
5. Repeat fixed questions on different days after pages are discoverable. Do not promise recommendation changes from publication alone.
