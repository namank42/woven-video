export type ChatModelRate = {
  name: string;
  modelId: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

export type FeatureRate = {
  name: string;
  description: string;
  rate: string;
  reference: string;
};

export type MediaModelRate = {
  name: string;
  capability: string;
  modelIds: string[];
  rate: string;
  notes: string;
};

// Public Woven rates after hosted markup. Keep this aligned with model_pricing_rules.
export const chatModelRates: ChatModelRate[] = [
  {
    name: "Claude Sonnet 4.6",
    modelId: "anthropic/claude-sonnet-4.6",
    input: "$3.60/M",
    output: "$18.00/M",
    cacheRead: "$0.36/M",
    cacheWrite: "$4.50/M",
  },
  {
    name: "Claude Opus 4.8",
    modelId: "anthropic/claude-opus-4.8",
    input: "$6.00/M",
    output: "$30.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "$7.50/M",
  },
  {
    name: "Claude Haiku 4.5",
    modelId: "anthropic/claude-haiku-4.5",
    input: "$1.20/M",
    output: "$6.00/M",
    cacheRead: "$0.12/M",
    cacheWrite: "$1.50/M",
  },
  {
    name: "GPT-5.5",
    modelId: "openai/gpt-5.5",
    input: "$6.00/M",
    output: "$36.00/M",
    cacheRead: "$0.60/M",
    cacheWrite: "—",
  },
  {
    name: "Kimi K2.6",
    modelId: "moonshotai/kimi-k2.6",
    input: "$1.14/M",
    output: "$4.80/M",
    cacheRead: "$0.19/M",
    cacheWrite: "—",
  },
  {
    name: "Grok 4.3",
    modelId: "xai/grok-4.3",
    input: "$1.50/M",
    output: "$3.00/M",
    cacheRead: "$0.24/M",
    cacheWrite: "—",
  },
];

export const mediaModelRates: MediaModelRate[] = [
  {
    name: "GPT Image 2",
    capability: "Image generation and editing",
    modelIds: ["openai/gpt-image-2", "openai/gpt-image-2/edit"],
    rate:
      "Text: $6.00/M input, $1.50/M cached, $12.00/M output · Image: $9.60/M input, $2.40/M cached, $36.00/M output",
    notes: "Actual request cost varies by image size and quality.",
  },
  {
    name: "Nano Banana Pro",
    capability: "Image generation and editing",
    modelIds: ["fal-ai/nano-banana-pro"],
    rate: "$0.18/image",
    notes: "4K: $0.36/image · Web search: +$0.018/request",
  },
  {
    name: "Gemini Omni Flash",
    capability: "Video generation and editing",
    modelIds: [
      "fal-ai/gemini-omni-flash",
      "fal-ai/gemini-omni-flash/image-to-video",
      "fal-ai/gemini-omni-flash/reference-to-video",
      "fal-ai/gemini-omni-flash/edit",
    ],
    rate: "$1.20/generation",
    notes: "3-10 seconds. Treats Fal's $1 unit as one generation unit.",
  },
  {
    name: "Veo 3.1",
    capability: "Video generation",
    modelIds: [
      "fal-ai/veo3.1",
      "fal-ai/veo3.1/image-to-video",
      "fal-ai/veo3.1/first-last-frame-to-video",
      "fal-ai/veo3.1/reference-to-video",
    ],
    rate: "$0.24/sec no audio · $0.48/sec audio",
    notes: "720p/1080p. 4K: $0.48/sec no audio, $0.72/sec audio.",
  },
  {
    name: "Veo 3.1 Fast",
    capability: "Video generation",
    modelIds: [
      "fal-ai/veo3.1/fast",
      "fal-ai/veo3.1/fast/image-to-video",
      "fal-ai/veo3.1/fast/first-last-frame-to-video",
    ],
    rate: "$0.12/sec no audio · $0.18/sec audio",
    notes: "720p/1080p. 4K: $0.36/sec no audio, $0.42/sec audio.",
  },
  {
    name: "Seedance 2.0",
    capability: "Video generation",
    modelIds: [
      "bytedance/seedance-2.0/text-to-video",
      "bytedance/seedance-2.0/image-to-video",
      "bytedance/seedance-2.0/reference-to-video",
    ],
    rate: "From $0.36/sec",
    notes: "720p. 1080p: $0.82/sec. Exact estimates shown before job submission.",
  },
  {
    name: "Seedance 2.0 Fast",
    capability: "Video generation",
    modelIds: [
      "bytedance/seedance-2.0/fast/text-to-video",
      "bytedance/seedance-2.0/fast/image-to-video",
      "bytedance/seedance-2.0/fast/reference-to-video",
    ],
    rate: "From $0.29/sec",
    notes: "720p. Exact estimates shown before job submission.",
  },
  {
    name: "Kling v3 Pro",
    capability: "Video generation",
    modelIds: [
      "fal-ai/kling-video/v3/pro/text-to-video",
      "fal-ai/kling-video/v3/pro/image-to-video",
    ],
    rate: "$0.13/sec audio off · $0.20/sec audio on",
    notes: "Voice control: $0.24/sec.",
  },
  {
    name: "Kling v3 Standard",
    capability: "Video generation",
    modelIds: [
      "fal-ai/kling-video/v3/standard/text-to-video",
      "fal-ai/kling-video/v3/standard/image-to-video",
    ],
    rate: "$0.10/sec audio off · $0.15/sec audio on",
    notes: "Voice control: $0.18/sec.",
  },
  {
    name: "Eleven Music v2",
    capability: "Music generation",
    modelIds: ["music_v2"],
    rate: "$0.20/min",
    notes: "$0.20 minimum. Up to 5 minutes.",
  },
];

export const featureRates: FeatureRate[] = [
  {
    name: "Auto captions",
    description: "Generates word-timed captions from a reel voiceover.",
    rate: "$0.10/min",
    reference: "$0.10 minimum",
  },
  {
    name: "Web Search",
    description: "Searches the web for current info.",
    rate: "$0.012/call",
    reference: "$12.00 / 1K calls",
  },
  {
    name: "Web Fetch",
    description: "Reads a webpage.",
    rate: "$0.006/call",
    reference: "$6.00 / 1K calls",
  },
];
