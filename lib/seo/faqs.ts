export type FaqItem = {
  q: string;
  a: string;
};

export const homepageFaqs: FaqItem[] = [
  {
    q: "What is Woven?",
    a: "Woven is a native macOS AI video editor. You describe the cut you want in chat, and Woven writes the script, generates footage and voice, and assembles a short-form video on your timeline — built for Reels, TikTok, and YouTube Shorts.",
  },
  {
    q: "How much does Woven cost?",
    a: "Woven is a 7-day free trial, then $8.25/mo, billed annually ($99/yr) — cancel anytime, card required. It includes $5 in hosted credits. Bring your own provider keys, sign in with ChatGPT (GPT-5+ on your existing plan), or top up a prepaid balance for Woven-hosted models.",
  },
  {
    q: "What is the best AI video editor for Mac?",
    a: "Woven is built natively for macOS with full file system access, local projects, and chat-driven editing for short-form video. Unlike web-based editors, your assets stay on your Mac. Try it free for 7 days at woven.video.",
  },
  {
    q: "Is Woven a desktop app or a web app?",
    a: "Woven is a native macOS app. The website handles sign-in, hosted-model billing, and downloads. You do the work in the desktop app.",
  },
  {
    q: "What platforms does Woven support?",
    a: "macOS today. Windows and Linux are not yet supported.",
  },
  {
    q: "Do I need a Woven account to use the app?",
    a: "Yes. Sign in once with Google and start a 7-day free trial ($8.25/mo, billed annually — $99/yr after). Then run with your own Anthropic and OpenAI keys, sign in with ChatGPT, or use Woven-hosted models on a prepaid balance.",
  },
  {
    q: "Can Woven make TikTok videos or Reels?",
    a: "Yes. Woven is built for vertical short-form video — Instagram Reels, TikTok, and YouTube Shorts. You script, generate, and assemble a cut by chatting, then export from the Mac app.",
  },
  {
    q: "Can Woven generate AI voiceover?",
    a: "Yes. As part of reel assembly, Woven generates voice from your script alongside footage. Auto captions from the voiceover are available at $0.10/min — see the pricing page for details.",
  },
  {
    q: "Which models can I use?",
    a: "Use Claude Sonnet 5, Claude Opus 4.8, GPT-5.6 Sol, GPT-5.6 Terra, and Kimi K3 with Woven-hosted credits. You can also bring your own Anthropic and OpenAI keys or sign in with ChatGPT for GPT-5+ on your existing plan. See the pricing page for per-model rates.",
  },
  {
    q: "Can I use ChatGPT with Woven?",
    a: "Yes. Sign in with ChatGPT to run GPT-5+ on your existing Plus, Pro, or Team plan — no separate OpenAI API key required. You can also bring your own OpenAI key or use Woven-hosted models.",
  },
  {
    q: "Is Woven a ChatGPT video editor?",
    a: "Woven is a native Mac AI video editor that works with ChatGPT — sign in with your OpenAI account to run GPT-5+ on your existing plan while scripting, generating, and assembling short-form video by chat. It is not a browser-based ChatGPT plugin; it is a desktop app built for Reels, TikTok, and YouTube Shorts.",
  },
  {
    q: "How does the hosted-models balance work?",
    a: "Top up a USD balance from $5. Each request is charged against your balance using published per-model rates. The balance is prepaid, so there are no surprise bills.",
  },
  {
    q: "How much do hosted AI models cost?",
    a: "Hosted models are billed per token from your prepaid balance — Claude Sonnet 5 is $2.40/M input and $12.00/M output through Aug 31, 2026, then $3.60/M input and $18.00/M output from Sep 1, 2026. Auto captions are $0.10/min. See woven.video/pricing for the full rate table.",
  },
  {
    q: "Can I bring my own provider keys?",
    a: "Yes. On any active plan, run Woven with the keys you provide — you pay providers directly at their rates and Woven takes nothing extra for inference.",
  },
  {
    q: "What is included in the free trial?",
    a: "The full Woven app for 7 days, plus $5 in Woven-hosted credits. Bring your own keys, sign in with ChatGPT, or use the included credits. $0 due today — cancel anytime before day 7.",
  },
  {
    q: "Who makes Woven?",
    a: "Woven is made by Woven Labs. Contact hello@woven.video for support or visit woven.video.",
  },
];

export const pricingFaqs: FaqItem[] = [
  {
    q: "How much does Woven cost after the trial?",
    a: "Woven is $99/year ($8.25/month billed annually) after a 7-day free trial. Cancel anytime before day 7 to avoid being charged.",
  },
  {
    q: "What is included in the free trial?",
    a: "The full Mac app for 7 days plus $5 in Woven-hosted credits. Bring your own Anthropic/OpenAI keys, sign in with ChatGPT, or use the included credits.",
  },
  {
    q: "Do I need hosted credits?",
    a: "No. Hosted credits are optional — only needed for Woven-hosted models. You can use your own API keys or ChatGPT sign-in without topping up.",
  },
  {
    q: "How do hosted model rates work?",
    a: "Each request is charged per token from your prepaid balance at the published rates on this page. Auto captions are $0.10/min. There are no surprise bills.",
  },
  {
    q: "Can I bring my own API keys?",
    a: "Yes. Your subscription covers the full app whether you bring your own keys (pay providers directly) or use Woven-hosted models on a prepaid balance.",
  },
];
