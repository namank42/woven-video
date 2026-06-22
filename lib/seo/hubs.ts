import type { FaqItem } from "@/lib/seo/faqs";

export type HubCard = {
  href: string;
  title: string;
  description: string;
};

export type HubPageContent = {
  path: string;
  title: string;
  description: string;
  h1: string;
  answerFirst: string;
  cards: HubCard[];
  faqs: FaqItem[];
};

export const compareHub: HubPageContent = {
  path: "/compare",
  title: "Compare Woven",
  description:
    "Compare Woven to CapCut, Descript, and Opus Clip. Find the right AI video editor for short-form video on Mac.",
  h1: "Compare Woven to other AI video editors",
  answerFirst:
    "Woven is a native Mac AI video editor for creating short-form video by chatting. Compare Woven to CapCut, Descript, and Opus Clip to find the right fit for your workflow.",
  cards: [
    {
      href: "/vs/capcut",
      title: "Woven vs CapCut",
      description:
        "CapCut alternative for Mac — create new Reels and TikToks with AI instead of template editing.",
    },
    {
      href: "/vs/descript",
      title: "Woven vs Descript",
      description:
        "Descript alternative for short-form video — chat-driven creation vs transcript editing.",
    },
    {
      href: "/vs/opus-clip",
      title: "Woven vs Opus Clip",
      description:
        "Opus Clip alternative — create new vertical video from a script, not just clip long-form.",
    },
    {
      href: "/best-ai-video-editor",
      title: "Best AI video editor roundup",
      description:
        "How Woven compares to CapCut, Descript, and Opus Clip for short-form video.",
    },
  ],
  faqs: [
    {
      q: "How does Woven compare to CapCut?",
      a: "CapCut is strong for free mobile template edits. Woven is a native Mac app for scripting, generating, and assembling new short-form video by chatting.",
    },
    {
      q: "Is Woven a Descript alternative?",
      a: "For short-form video on Mac, yes. Descript excels at podcast and transcript editing; Woven focuses on creating new Reels, TikToks, and Shorts.",
    },
  ],
};

export const useCaseHub: HubPageContent = {
  path: "/for",
  title: "Use Cases",
  description:
    "Make Reels, TikToks, and YouTube Shorts with Woven on Mac. AI video editing built for vertical short-form video.",
  h1: "AI video editing for every short-form platform",
  answerFirst:
    "Woven is built for vertical short-form video on Mac. Script, generate footage and voice, and assemble a cut by chatting — for Instagram Reels, TikTok, and YouTube Shorts.",
  cards: [
    {
      href: "/for/reels",
      title: "Instagram Reels",
      description: "AI Reels maker — script, generate, and assemble on your Mac.",
    },
    {
      href: "/for/tiktok",
      title: "TikTok",
      description: "Create TikTok videos with chat-driven AI editing.",
    },
    {
      href: "/for/youtube-shorts",
      title: "YouTube Shorts",
      description: "Make YouTube Shorts with native Mac AI video editing.",
    },
    {
      href: "/ai-video-editor-mac",
      title: "AI video editor for Mac",
      description: "Why Woven is built natively for macOS creators.",
    },
  ],
  faqs: [
    {
      q: "Can Woven make Reels, TikToks, and Shorts?",
      a: "Yes. Woven is built for vertical short-form video across Instagram Reels, TikTok, and YouTube Shorts.",
    },
    {
      q: "Do I need editing experience?",
      a: "No. Describe what you want in chat and revise like a conversation — Woven assembles the timeline.",
    },
  ],
};