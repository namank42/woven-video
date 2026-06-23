import type { FaqItem } from "@/lib/seo/faqs";

export type ComparisonRow = {
  feature: string;
  woven: string;
  competitor: string;
};

export type ComparisonPageContent = {
  path: string;
  title: string;
  description: string;
  h1: string;
  verdict: string;
  answerFirst: string;
  competitorName: string;
  rows: ComparisonRow[];
  chooseWoven: string[];
  chooseCompetitor: string[];
  faqs: FaqItem[];
};

export type UseCasePageContent = {
  path: string;
  title: string;
  description: string;
  h1: string;
  answerFirst: string;
  workflow: string[];
  faqs: FaqItem[];
};

export type RoundupEntry = {
  name: string;
  bestFor: string;
  platform: string;
  pricing: string;
  highlight: string;
};

export type RoundupPageContent = {
  path: string;
  title: string;
  description: string;
  h1: string;
  answerFirst: string;
  entries: RoundupEntry[];
  criteria: string[];
  faqs: FaqItem[];
};

export type FeaturePageContent = {
  path: string;
  title: string;
  description: string;
  h1: string;
  answerFirst: string;
  highlights: { title: string; body: string }[];
  faqs: FaqItem[];
};

export const capcutComparison: ComparisonPageContent = {
  path: "/vs/capcut",
  title: "CapCut Alternative for Mac",
  description:
    "Looking for a CapCut alternative or alternative to CapCut on Mac? Woven is a native AI video editor for short-form video — a strong CapCut alternative free to try for 7 days. Script, generate, and assemble Reels and TikToks by chatting.",
  h1: "CapCut Alternative for Mac",
  verdict:
    "CapCut is a capable free mobile editor; Woven is a native Mac app for creating short-form video with AI from a script — not just editing clips you already have.",
  answerFirst:
    "Woven is a CapCut alternative built natively for macOS — and a practical alternative to CapCut if you work on a Mac. Instead of manually editing on a timeline, you script, generate footage and voice, and assemble vertical video by chatting — built for Reels, TikTok, and YouTube Shorts.",
  competitorName: "CapCut",
  rows: [
    { feature: "Platform", woven: "Native macOS app", competitor: "Web, iOS, Android, desktop" },
    { feature: "Workflow", woven: "Chat-driven script → generate → assemble", competitor: "Manual timeline editing" },
    { feature: "AI generation", woven: "Script, footage, voice in one flow", competitor: "Templates, effects, some AI tools" },
    { feature: "File access", woven: "Full local file system", competitor: "Upload/cloud-centric" },
    { feature: "Best for", woven: "Creating new short-form cuts on Mac", competitor: "Quick mobile edits and templates" },
    { feature: "Pricing", woven: "7-day trial, then $99/yr", competitor: "Free tier + Pro subscription" },
  ],
  chooseWoven: [
    "You work on a Mac and want local projects",
    "You start from a script or idea, not just existing clips",
    "You want chat-driven assembly for Reels, TikTok, or Shorts",
    "You need Claude, GPT, or your own keys in the editor",
  ],
  chooseCompetitor: [
    "You need a free mobile editor today",
    "You already have footage and just need fast template edits",
    "You are not on macOS",
  ],
  faqs: [
    {
      q: "Is Woven a good CapCut alternative for Mac?",
      a: "Yes, if you want to create short-form video on Mac with AI — not just edit existing clips. Woven is native macOS, chat-driven, and built for Reels, TikTok, and Shorts. CapCut is stronger for free mobile template editing.",
    },
    {
      q: "Does Woven replace CapCut entirely?",
      a: "Not for everyone. CapCut excels at quick template-based mobile edits. Woven excels at scripting, generating, and assembling new vertical video on your Mac.",
    },
    {
      q: "How much does Woven cost vs CapCut?",
      a: "Woven is a 7-day free trial, then $99/year. CapCut has a popular free tier and optional Pro plans. See woven.video/pricing for Woven's full pricing.",
    },
    {
      q: "Can Woven export vertical video for TikTok and Reels?",
      a: "Yes. Woven is built for short-form vertical video — Reels, TikTok, and YouTube Shorts.",
    },
    {
      q: "Is Woven a free CapCut alternative?",
      a: "Woven offers a 7-day free trial — so you can try it as a CapCut alternative free before paying. After the trial, Woven is $99/year. CapCut has a popular free tier for mobile template edits; Woven is built for Mac creators who want AI-driven scripting and assembly.",
    },
    {
      q: "What is the best CapCut alternative for Mac?",
      a: "For creating new short-form video on Mac with AI, Woven is among the best CapCut alternatives: native macOS, local projects, chat-driven scripting and assembly. CapCut remains stronger for free mobile template editing from existing clips.",
    },
    {
      q: "CapCut vs Descript — where does Woven fit?",
      a: "CapCut is a free mobile editor for template-based cuts. Descript is transcript-first for full podcast episodes. Woven sits between them for Mac creators who clip podcasts or create new Reels, TikToks, and Shorts by chatting — without a manual timeline or full transcript workflow.",
    },
    {
      q: "Is there a CapCut alternative for Mac with a free trial?",
      a: "Yes. Woven is a CapCut alternative for Mac with a 7-day free trial and full app access. Your projects stay local on your Mac. See woven.video/pricing for details after the trial.",
    },
  ],
};

export const descriptComparison: ComparisonPageContent = {
  path: "/vs/descript",
  title: "Descript Alternative",
  description:
    "Descript alternative for short-form video on Mac. Clip podcasts and interviews into Reels, TikTok, and Shorts — or create new vertical video — with chat-driven AI editing.",
  h1: "Descript Alternative for Short-Form Video",
  verdict:
    "Both tools work with podcast footage. Descript excels at transcript-first editing of full episodes; Woven clips podcasts and interviews into Reels, TikToks, and Shorts on Mac — or helps you create new vertical video from scratch by chatting.",
  answerFirst:
    "Woven is a Descript alternative for short-form video on Mac. Clip podcast and interview episodes into Reels, TikToks, and Shorts, or create new vertical video from a script — all by chatting.",
  competitorName: "Descript",
  rows: [
    { feature: "Primary use case", woven: "Short-form vertical video", competitor: "Long-form podcast and transcription editing" },
    { feature: "Podcast clipping", woven: "Yes — chat-driven shorts from recordings", competitor: "Yes — export clips from transcript edits" },
    { feature: "Workflow", woven: "Chat-driven clip + create + assemble", competitor: "Text-based edit of recorded audio/video" },
    { feature: "Platform", woven: "Native macOS", competitor: "macOS and Windows" },
    { feature: "AI models", woven: "Claude, GPT, BYOK, or hosted", competitor: "Descript's AI suite + Underlord" },
    { feature: "Generation", woven: "Script → footage + voice → timeline", competitor: "Overdub, eye contact, studio sound" },
    { feature: "Best for", woven: "Reels/TikToks/Shorts — new or from recordings", competitor: "Full-episode transcript editing" },
  ],
  chooseWoven: [
    "You clip podcasts, interviews, or webinars into Reels, TikToks, and Shorts",
    "You want to create new vertical video or repurpose recordings with a chat-driven Mac workflow",
    "You prefer a native Mac app over a cross-platform editor",
  ],
  chooseCompetitor: [
    "Your daily workflow is transcript-first editing of full podcast episodes",
    "You need Descript-specific features like Overdub, Studio Sound, or Underlord",
    "You need Windows support",
  ],
  faqs: [
    {
      q: "Is Woven a Descript alternative?",
      a: "For short-form video on Mac, yes. Woven clips podcasts and interviews into vertical shorts and can create new video from a script — all by chatting. Descript is stronger when your daily workflow is transcript-first editing of full long-form episodes.",
    },
    {
      q: "Can Woven clip podcasts?",
      a: "Yes. Woven clips podcast and interview recordings into Reels, TikToks, and Shorts on Mac. Ask for the moments you want, refine the cut by chatting, and export vertical video. Descript is the better fit if you need to edit entire episodes line-by-line in a transcript.",
    },
    {
      q: "Which is better for TikTok and Reels?",
      a: "Woven is built for vertical short-form output on Mac — clipping podcasts and interviews or creating from scratch. Descript can export short clips too, but its core workflow is editing full episodes via the transcript.",
    },
    {
      q: "Opus Clip vs Descript — how is Woven different?",
      a: "Opus Clip auto-extracts clips from uploaded long-form video. Descript edits full episodes via transcript. Woven is a Mac-native alternative for clipping podcasts into Reels, TikToks, and Shorts by chatting — or creating new vertical video from a script.",
    },
    {
      q: "Can Woven make AI podcast clips?",
      a: "Yes. Woven clips podcast and interview recordings into vertical shorts on Mac. Ask for the moments you want, refine by chatting, and export for Reels, TikTok, or YouTube Shorts. Descript is the better fit for line-by-line transcript editing of full episodes.",
    },
  ],
};

export const opusClipComparison: ComparisonPageContent = {
  path: "/vs/opus-clip",
  title: "Opus Clip Alternative",
  description:
    "Opus Clip alternative for Mac creators. Clip podcasts and long-form video into Reels, TikTok, and Shorts — or create new vertical video — with chat-driven AI editing.",
  h1: "Opus Clip Alternative",
  verdict:
    "Opus Clip auto-extracts clips from uploaded long-form video; Woven clips podcasts and recordings into shorts on Mac by chatting — and can create new vertical video from a script too.",
  answerFirst:
    "Woven is an Opus Clip alternative for Mac creators. Clip podcast and interview episodes into Reels, TikToks, and Shorts, or create new vertical video from a script — guided by chat instead of batch auto-extraction.",
  competitorName: "Opus Clip",
  rows: [
    { feature: "Starting point", woven: "Recording, script, or brief", competitor: "Long-form video upload" },
    { feature: "Output", woven: "Clipped or assembled short-form cut", competitor: "Auto-extracted clips" },
    { feature: "Platform", woven: "Native macOS app", competitor: "Web-based" },
    { feature: "Workflow", woven: "Chat-driven clip + create + edit", competitor: "AI clipping + captions" },
    { feature: "Local files", woven: "Full Mac file system", competitor: "Upload-first" },
    { feature: "Best for", woven: "Clipping podcasts + creating shorts on Mac", competitor: "Batch auto-clipping at scale" },
  ],
  chooseWoven: [
    "You clip podcasts, interviews, or webinars into Reels, TikToks, and Shorts on Mac",
    "You want chat-guided clipping and editing, not just automated extraction",
    "You also create new short-form video from a script",
  ],
  chooseCompetitor: [
    "You want fully automated batch clipping with minimal editing",
    "You repurpose dozens of long videos at once via web upload",
  ],
  faqs: [
    {
      q: "Is Woven an Opus Clip alternative?",
      a: "For short-form video on Mac, yes. Woven clips podcasts and long recordings into vertical shorts by chatting. Opus Clip auto-extracts clips from uploaded long-form video at scale.",
    },
    {
      q: "Can Woven clip podcasts and long videos?",
      a: "Yes. Woven clips podcast and interview recordings into Reels, TikToks, and Shorts on Mac. Opus Clip is built for automated batch extraction from web uploads; Woven gives you a chat-driven Mac workflow for clipping and refining cuts.",
    },
    {
      q: "Opus Clip vs Descript — which is Woven closer to?",
      a: "Woven overlaps with both: like Opus Clip, it turns long recordings into shorts; like Descript, it works with podcast footage. Woven differs by offering a native Mac, chat-driven workflow for clipping and creating vertical video — not batch web extraction or full transcript editing.",
    },
    {
      q: "Is Woven an AI clip maker?",
      a: "Yes, for short-form video on Mac. Woven acts as an AI clip maker when you pull moments from podcasts, interviews, or long recordings into Reels, TikToks, and Shorts — and when you generate new vertical cuts from a script. Opus Clip focuses on automated batch clipping from web uploads.",
    },
  ],
};

export const macEditorPage: FeaturePageContent = {
  path: "/ai-video-editor-mac",
  title: "AI Video Editor for Mac",
  description:
    "Woven is the AI video editor for Mac. Native app, local projects, chat-driven editing for Reels, TikTok, and YouTube Shorts. Try free for 7 days.",
  h1: "AI Video Editor for Mac",
  answerFirst:
    "Woven is a native AI video editor for Mac. Your projects and media stay local, you script and generate short-form video by chatting, and you export vertical cuts for Reels, TikTok, and YouTube Shorts.",
  highlights: [
    {
      title: "Native macOS",
      body: "Full file system access. Drop folders in, work on local projects — no upload-first workflow.",
    },
    {
      title: "Chat-driven editing",
      body: "Describe the cut you want. Woven writes the script, generates footage and voice, and assembles the timeline.",
    },
    {
      title: "Your models, your way",
      body: "Bring Anthropic and OpenAI keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.",
    },
    {
      title: "Built for short-form",
      body: "Reels, TikTok, and YouTube Shorts — not a general-purpose NLE bolted onto AI.",
    },
  ],
  faqs: [
    {
      q: "What is the best AI video editor for Mac?",
      a: "Woven is built natively for macOS with local projects and chat-driven short-form editing. Unlike web-based tools, your assets stay on your Mac. Try it free for 7 days.",
    },
    {
      q: "Does Woven work on Windows?",
      a: "No. Woven is macOS-only today.",
    },
    {
      q: "Is Woven a web app or a Mac app?",
      a: "Woven is a native Mac app. woven.video handles sign-in, billing, and downloads.",
    },
  ],
};

export const reelsUseCase: UseCasePageContent = {
  path: "/for/reels",
  title: "AI Reels Maker & Generator for Mac",
  description:
    "AI Reels maker and AI Reels generator for Mac. Make Instagram Reels with AI — script, generate footage and voice, and assemble vertical video by chatting. Free to try for 7 days.",
  h1: "AI Reels Maker & Generator for Mac",
  answerFirst:
    "Woven is an AI Reels maker and AI Reels generator for Mac. Describe the reel you want — or say make Reels with AI — and Woven writes the script, generates footage and voice, and assembles a vertical cut ready for Instagram Reels.",
  workflow: [
    "Open Woven on your Mac and start from your assets or a blank reel",
    "Chat the concept — hook, pacing, shots, and voiceover",
    "Woven generates footage, voice, and assembles the timeline",
    "Review, revise by chatting, and export for Reels",
  ],
  faqs: [
    {
      q: "Can Woven make Instagram Reels?",
      a: "Yes. Woven is built for vertical short-form video including Instagram Reels. You script, generate, and assemble by chatting on your Mac.",
    },
    {
      q: "What is the best AI Reels generator for Mac?",
      a: "Woven is an AI Reels generator built natively for macOS. You describe the reel, and Woven generates the script, footage, voice, and timeline assembly by chat — designed for Instagram Reels, not general desktop editing.",
    },
    {
      q: "How do I make Reels with AI?",
      a: "In Woven on your Mac: describe the reel concept in chat, let Woven write the script and generate footage and voice, revise by chatting, then export a vertical cut for Instagram Reels. No timeline editing experience required.",
    },
    {
      q: "Is there a free AI Reels generator?",
      a: "Woven offers a 7-day free trial with full app access — try it as a free AI Reels generator before subscribing. After the trial, Woven is $99/year. See woven.video/pricing for details.",
    },
    {
      q: "Is Woven an AI Reels editor?",
      a: "Yes. Woven is an AI Reels editor for Mac creators who want to script, generate, and assemble vertical video by chatting — not just trim clips on a manual timeline.",
    },
    {
      q: "Do I need video editing experience?",
      a: "No. You describe what you want in chat and revise like a conversation — Woven handles assembly on the timeline.",
    },
  ],
};

export const tiktokUseCase: UseCasePageContent = {
  path: "/for/tiktok",
  title: "AI TikTok Video Editor for Mac",
  description:
    "Create TikTok videos with AI on Mac. Woven scripts, generates footage and voice, and assembles vertical cuts by chatting. 7-day free trial.",
  h1: "AI TikTok Video Editor for Mac",
  answerFirst:
    "Woven is an AI TikTok video editor for Mac. Script your video, generate footage and voice, and assemble a vertical cut by chatting — built for TikTok's format.",
  workflow: [
    "Start a new reel project in Woven on your Mac",
    "Describe the TikTok concept — hook, beats, and tone",
    "Generate footage, voiceover, and timeline assembly in chat",
    "Export a vertical cut ready for TikTok",
  ],
  faqs: [
    {
      q: "Can Woven make TikTok videos?",
      a: "Yes. Woven creates vertical short-form video for TikTok by scripting, generating, and assembling in a native Mac app.",
    },
    {
      q: "Is Woven better than CapCut for TikTok on Mac?",
      a: "CapCut is strong for template-based mobile edits. Woven is better when you want to create and assemble new TikToks from a script on your Mac with AI.",
    },
  ],
};

export const shortsUseCase: UseCasePageContent = {
  path: "/for/youtube-shorts",
  title: "AI YouTube Shorts Editor for Mac",
  description:
    "Make YouTube Shorts with AI on Mac. Woven scripts, generates, and assembles vertical video by chatting. 7-day free trial.",
  h1: "AI YouTube Shorts Editor for Mac",
  answerFirst:
    "Woven is an AI YouTube Shorts editor for Mac. Describe the short you want, generate footage and voice, and assemble a vertical cut by chatting.",
  workflow: [
    "Create a reel project in Woven",
    "Chat your Short concept — opening hook, pacing, and CTA",
    "Generate and assemble footage and voiceover",
    "Export vertical video for YouTube Shorts",
  ],
  faqs: [
    {
      q: "Can Woven make YouTube Shorts?",
      a: "Yes. Woven builds vertical short-form video suited for YouTube Shorts, along with Reels and TikTok.",
    },
  ],
};

export const bestEditorRoundup: RoundupPageContent = {
  path: "/best-ai-video-editor",
  title: "Best AI Video Editor",
  description:
    "Compare the best AI video editors and content repurposing tools for short-form video in 2026 — Woven, CapCut, Descript, and Opus Clip. Find the right tool for Mac, mobile, and repurposing.",
  h1: "Best AI Video Editor for Short-Form Video",
  answerFirst:
    "The best AI video editor depends on your workflow: Woven for clipping podcasts and creating short-form video on Mac by chatting, CapCut for free mobile template edits (and as a best CapCut alternative on Mac), Descript for transcript-based full-episode editing, and Opus Clip for automated batch clipping. For content repurposing, Woven and Opus Clip turn long recordings into Reels, TikToks, and Shorts.",
  criteria: [
    "Platform (Mac-native vs web/mobile)",
    "Workflow (create vs edit vs clip)",
    "Short-form fit (Reels, TikTok, Shorts)",
    "AI generation vs manual editing",
    "Pricing model",
  ],
  entries: [
    {
      name: "Woven",
      bestFor: "Clipping podcasts and creating shorts on Mac",
      platform: "macOS (native)",
      pricing: "7-day trial, then $99/yr",
      highlight: "Chat-driven clip, create, and assemble",
    },
    {
      name: "CapCut",
      bestFor: "Free mobile and template-based edits",
      platform: "Web, iOS, Android",
      pricing: "Free + Pro",
      highlight: "Fast template edits and effects",
    },
    {
      name: "Descript",
      bestFor: "Podcast and transcript-first editing",
      platform: "macOS, Windows",
      pricing: "Free + paid tiers",
      highlight: "Edit video by editing text",
    },
    {
      name: "Opus Clip",
      bestFor: "Repurposing long video into clips",
      platform: "Web",
      pricing: "Free + paid tiers",
      highlight: "Auto-clip long-form video",
    },
  ],
  faqs: [
    {
      q: "What is the best AI video editor for Mac?",
      a: "For clipping podcasts and creating short-form video on Mac, Woven is built natively for that workflow — chat-driven clipping, generation, and assembly. CapCut and Descript are stronger for other use cases.",
    },
    {
      q: "What is the best free AI video editor?",
      a: "CapCut offers a capable free tier for mobile template editing. Woven offers a 7-day free trial for Mac creators who want AI-driven short-form assembly.",
    },
    {
      q: "Which AI video editor is best for TikTok and Reels?",
      a: "Woven and CapCut are common choices. Woven suits Mac creators clipping podcasts or starting from a script; CapCut suits quick mobile edits from existing clips.",
    },
    {
      q: "What is the best content repurposing tool for video?",
      a: "For Mac creators, Woven is a strong content repurposing tool: clip podcasts and interviews into Reels, TikToks, and Shorts, or create new vertical video from a script — all by chatting. Opus Clip suits automated batch clipping from web uploads; Descript suits transcript-first full-episode editing.",
    },
    {
      q: "What is the best CapCut alternative?",
      a: "On Mac, Woven is a top CapCut alternative for creators who want to script, generate, and assemble new short-form video with AI — not just edit existing clips on mobile. CapCut remains best for free template-based mobile edits.",
    },
  ],
};