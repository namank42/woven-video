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
    "Looking for a CapCut alternative on Mac? Woven is a native AI video editor for short-form video — script, generate, and assemble Reels and TikToks by chatting. 7-day free trial.",
  h1: "CapCut Alternative for Mac",
  verdict:
    "CapCut is a capable free mobile editor; Woven is a native Mac app for creating short-form video with AI from a script — not just editing clips you already have.",
  answerFirst:
    "Woven is a CapCut alternative built natively for macOS. Instead of manually editing on a timeline, you script, generate footage and voice, and assemble vertical video by chatting — built for Reels, TikTok, and YouTube Shorts. Try free for 7 days, then $99/year.",
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
  ],
};

export const descriptComparison: ComparisonPageContent = {
  path: "/vs/descript",
  title: "Descript Alternative",
  description:
    "Descript alternative for short-form video on Mac. Woven is chat-driven AI video editing for Reels, TikTok, and Shorts — script, generate, and assemble by asking.",
  h1: "Descript Alternative for Short-Form Video",
  verdict:
    "Descript is excellent for podcast-style transcription editing; Woven is built for creating and assembling new short-form vertical video on Mac by chatting.",
  answerFirst:
    "Woven is a Descript alternative focused on short-form video on Mac. Describe the reel you want, and Woven writes the script, generates footage and voice, and assembles the cut — built for Reels, TikTok, and Shorts. Try free for 7 days.",
  competitorName: "Descript",
  rows: [
    { feature: "Primary use case", woven: "Short-form vertical video", competitor: "Podcasts, talking-head, transcription" },
    { feature: "Workflow", woven: "Chat-driven create + assemble", competitor: "Text-based edit of recorded audio/video" },
    { feature: "Platform", woven: "Native macOS", competitor: "macOS and Windows" },
    { feature: "AI models", woven: "Claude, GPT, BYOK, or hosted", competitor: "Descript's AI suite + Underlord" },
    { feature: "Generation", woven: "Script → footage + voice → timeline", competitor: "Overdub, eye contact, studio sound" },
    { feature: "Best for", woven: "New Reels/TikToks/Shorts on Mac", competitor: "Editing recorded long-form content" },
  ],
  chooseWoven: [
    "You make Reels, TikToks, or Shorts — not podcasts",
    "You want to generate and assemble, not just edit recordings",
    "You prefer a chat-driven Mac workflow",
  ],
  chooseCompetitor: [
    "You edit podcasts or interview footage",
    "Transcript-based editing of existing recordings is your core workflow",
    "You need Windows support",
  ],
  faqs: [
    {
      q: "Is Woven a Descript alternative?",
      a: "For short-form video on Mac, yes. Woven is built to script, generate, and assemble vertical video by chatting. Descript is stronger for transcript-first editing of recorded long-form content.",
    },
    {
      q: "Does Woven do transcript editing like Descript?",
      a: "Woven is not a podcast editor. It focuses on creating and assembling short-form video with AI — script, generation, voice, and timeline assembly in one Mac app.",
    },
    {
      q: "Which is better for TikTok and Reels?",
      a: "Woven is purpose-built for vertical short-form output. Descript can export short clips, but its core workflow is transcript editing of longer recordings.",
    },
  ],
};

export const opusClipComparison: ComparisonPageContent = {
  path: "/vs/opus-clip",
  title: "Opus Clip Alternative",
  description:
    "Opus Clip alternative for Mac creators. Woven creates and assembles short-form video with AI — not just clipping long videos. Native macOS, 7-day free trial.",
  h1: "Opus Clip Alternative",
  verdict:
    "Opus Clip turns long videos into short clips automatically; Woven helps you create and assemble new short-form video from a script on your Mac.",
  answerFirst:
    "Woven is an Opus Clip alternative for creators who start from an idea, not a long recording. On Mac, you script, generate footage and voice, and assemble Reels, TikToks, and Shorts by chatting — instead of auto-clipping existing long-form video.",
  competitorName: "Opus Clip",
  rows: [
    { feature: "Starting point", woven: "Script or creative brief", competitor: "Long-form video upload" },
    { feature: "Output", woven: "New assembled short-form cut", competitor: "Auto-extracted clips" },
    { feature: "Platform", woven: "Native macOS app", competitor: "Web-based" },
    { feature: "Workflow", woven: "Chat-driven generation + edit", competitor: "AI clipping + captions" },
    { feature: "Local files", woven: "Full Mac file system", competitor: "Upload-first" },
    { feature: "Best for", woven: "Creating new vertical video", competitor: "Repurposing long video" },
  ],
  chooseWoven: [
    "You create new short-form content from scratch",
    "You work on Mac with local assets",
    "You want generation and assembly, not just clipping",
  ],
  chooseCompetitor: [
    "You have long webinars or podcasts to repurpose",
    "Auto-clip extraction from existing video is your main need",
  ],
  faqs: [
    {
      q: "Is Woven an Opus Clip alternative?",
      a: "For creating new short-form video on Mac, yes. Opus Clip repurposes long video into clips; Woven scripts, generates, and assembles new vertical cuts by chatting.",
    },
    {
      q: "Can Woven clip long videos like Opus Clip?",
      a: "Woven is not a long-to-short clipping tool. It is an AI video editor for making new Reels, TikToks, and Shorts from a script on your Mac.",
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
    "Woven is a native AI video editor for Mac. Your projects and media stay local, you script and generate short-form video by chatting, and you export vertical cuts for Reels, TikTok, and YouTube Shorts. Try free for 7 days, then $99/year.",
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
  title: "AI Reels Maker for Mac",
  description:
    "Make Instagram Reels with AI on Mac. Woven scripts, generates, and assembles vertical video by chatting. 7-day free trial.",
  h1: "AI Reels Maker for Mac",
  answerFirst:
    "Woven is an AI Reels maker for Mac. Describe the reel you want, and Woven writes the script, generates footage and voice, and assembles a vertical cut — ready for Instagram Reels. Try free for 7 days.",
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
    "Woven is an AI TikTok video editor for Mac. Script your video, generate footage and voice, and assemble a vertical cut by chatting — built for TikTok's format. Try free for 7 days.",
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
    "Woven is an AI YouTube Shorts editor for Mac. Describe the short you want, generate footage and voice, and assemble a vertical cut by chatting. Try free for 7 days.",
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
    "Compare the best AI video editors for short-form video in 2026 — Woven, CapCut, Descript, and Opus Clip. Find the right tool for Mac, mobile, and repurposing.",
  h1: "Best AI Video Editor for Short-Form Video",
  answerFirst:
    "The best AI video editor depends on your workflow: Woven for creating new short-form video on Mac by chatting, CapCut for free mobile template edits, Descript for transcript-based podcast editing, and Opus Clip for clipping long video into shorts.",
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
      bestFor: "Creating new short-form video on Mac",
      platform: "macOS (native)",
      pricing: "7-day trial, then $99/yr",
      highlight: "Chat-driven script → generate → assemble",
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
      a: "For creating new short-form video on Mac, Woven is built natively for that workflow — chat-driven script, generation, and assembly. CapCut and Descript are stronger for other use cases.",
    },
    {
      q: "What is the best free AI video editor?",
      a: "CapCut offers a capable free tier for mobile template editing. Woven offers a 7-day free trial for Mac creators who want AI-driven short-form assembly.",
    },
    {
      q: "Which AI video editor is best for TikTok and Reels?",
      a: "Woven and CapCut are common choices. Woven suits Mac creators starting from a script; CapCut suits quick mobile edits from existing clips.",
    },
  ],
};