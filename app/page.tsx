import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  AppleIcon,
  CheckIcon,
  KeyIcon,
  LaptopIcon,
  LayersIcon,
  PencilLineIcon,
  PuzzleIcon,
  SparklesIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ReelTile } from "@/components/reel-tile";
import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/utils";

const DOWNLOAD_URL = "https://release.woven.video/Woven.dmg";

const reels = [
  {
    label: "AI presenter",
    gradient: "from-zinc-900 via-zinc-700 to-zinc-500",
    videoUrl: "https://media.wovenlabs.net/woven-reels/no-caption-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/no-caption-poster.jpg",
  },
  {
    label: "Skincare ad",
    gradient: "from-neutral-900 via-neutral-600 to-neutral-400",
    videoUrl: "https://media.wovenlabs.net/woven-reels/linger-brand-awareness-v13-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/linger-brand-awareness-v13-poster.jpg",
  },
  {
    label: "Lifestyle",
    gradient: "from-slate-900 via-slate-700 to-slate-400",
    videoUrl: "https://media.wovenlabs.net/woven-reels/loft-showcase-v20-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/loft-showcase-v20-poster.jpg",
  },
  {
    label: "Animation",
    gradient: "from-gray-900 via-gray-600 to-gray-300",
    videoUrl: "https://media.wovenlabs.net/woven-reels/theo-honesty-v10-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/theo-honesty-v10-poster-v2.jpg",
  },
  {
    label: "Product demo",
    gradient: "from-stone-900 via-stone-700 to-stone-400",
    videoUrl: "https://media.wovenlabs.net/woven-reels/drift-demo-v31-full.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/drift-demo-v31-poster.jpg",
  },
];

type FeatureCard = {
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  body: string;
};

const featureCards: FeatureCard[] = [
  {
    icon: SparklesIcon,
    eyebrow: "Chat-driven",
    title: "Make a reel by chatting.",
    body: "Describe the cut you want. Woven writes the script, generates the footage and voice, and assembles the timeline. You review and revise like a conversation — not a timeline.",
  },
  {
    icon: LaptopIcon,
    eyebrow: "macOS-native",
    title: "Built for your Mac.",
    body: "Full file system access. Drop folders in, work on local projects, no uploads.",
  },
  {
    icon: KeyIcon,
    eyebrow: "Your keys, or ours",
    title: "Local with your keys. Or hosted on a prepaid balance.",
    body: "Free with your own Anthropic and OpenAI keys. Sign in for Woven-hosted models — same lineup, no key juggling.",
  },
  {
    icon: LayersIcon,
    eyebrow: "Multimodal",
    title: "Generate and reason across media.",
    body: "Images, video, audio — pick any model, or compare across them. Then point Claude or GPT at any file in your project to analyze or transform.",
  },
  {
    icon: PencilLineIcon,
    eyebrow: "Preview + edit",
    title: "See your files. Shape them by chatting.",
    body: "Open any video, image, or audio file directly in Woven. Trim, adjust, or replace by asking — no bouncing between apps.",
  },
  {
    icon: PuzzleIcon,
    eyebrow: "Skills + memory",
    title: "Works with your Claude setup.",
    body: "Woven respects your existing Claude skills and memory. Workflows you've built elsewhere carry into the app.",
  },
];

const faqs = [
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
    a: "Yes. Sign in once with Google. Then choose: run locally with your own Anthropic and OpenAI keys, or use Woven-hosted models on a prepaid balance.",
  },
  {
    q: "Which models can I use?",
    a: "The same lineup either way — Claude Sonnet 4.6, Claude Opus 4.7, Claude Haiku 4.5, and GPT-5.5. Locally you bring your own Anthropic and OpenAI keys; with Woven-hosted, charges come from your prepaid balance. See the pricing page for per-model rates.",
  },
  {
    q: "How does the hosted-models balance work?",
    a: "Top up a USD balance from $5. Each request is charged against your balance using published per-model rates. The balance is prepaid, so there are no surprise bills.",
  },
  {
    q: "Can I bring my own provider keys?",
    a: "Yes. Local mode uses keys you provide. You pay providers directly at their rates and Woven takes nothing.",
  },
];

const SITE_URL = "https://www.woven.video";

function StructuredData() {
  const organization = {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Woven",
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/woven-logo.png`,
      width: 1024,
      height: 1024,
    },
    description:
      "Woven is the AI Video Editor — a native macOS app for making and editing short-form video by asking.",
    slogan: "The AI Video Editor.",
  };

  const website = {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: "Woven",
    description: "The AI Video Editor.",
    inLanguage: "en-US",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  const application = {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: "Woven",
    operatingSystem: "macOS",
    applicationCategory: "MultimediaApplication",
    description:
      "Woven is the AI Video Editor. A native macOS app to script, edit, and assemble short-form video by asking. Bring your own provider keys, or use Woven-hosted models on a prepaid balance.",
    url: SITE_URL,
    downloadUrl: DOWNLOAD_URL,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  const faqPage = {
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  const graph = {
    "@context": "https://schema.org",
    "@graph": [organization, website, application, faqPage],
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <StructuredData />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <MadeWithWoven />
        <Features />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="Woven home">
          <Image
            src="/woven-logo.png"
            alt=""
            width={28}
            height={28}
            className="rounded-md"
            priority
          />
          <span className="font-heading text-base font-medium">Woven</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">
            Features
          </a>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <a href="#faq" className="hover:text-foreground">
            FAQ
          </a>
        </nav>
        <HeaderAuthControls />
      </div>
    </header>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-foreground" />
      {children}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* atmospheric backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      >
        {/* dot grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--foreground) 14%, transparent) 1.5px, transparent 0)",
            backgroundSize: "22px 22px",
            maskImage:
              "radial-gradient(ellipse 80% 65% at 50% 30%, black, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 65% at 50% 30%, black, transparent 80%)",
          }}
        />
        {/* soft halo on top */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 55% at 50% 0%, color-mix(in oklch, var(--foreground) 7%, transparent), transparent 65%)",
          }}
        />
      </div>
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-14 pb-12 text-center md:pt-16 md:pb-16">
        <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-5xl lg:text-6xl">
          The AI Video Editor.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Script. Shot list. Generate. Animate. Edit. Assemble.
          <span className="mt-1 block font-medium text-foreground">
            All in one place.
          </span>
        </p>
        <Button
          nativeButton={false}
          className="mt-8 h-12 rounded-full px-7 text-base font-medium shadow-lg shadow-foreground/10"
          render={<a href={DOWNLOAD_URL} download />}
        >
          <AppleIcon className="size-4" />
          Download for Mac
        </Button>
        <HeroMedia />
      </div>
    </section>
  );
}

function HeroMedia() {
  return (
    <div className="relative mx-auto mt-10 w-full max-w-5xl md:mt-12 lg:max-w-6xl">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-12 -top-8 -bottom-16 rounded-[3rem] bg-foreground/5 blur-3xl md:-inset-x-24"
      />
      <div className="relative overflow-hidden rounded-lg shadow-2xl shadow-foreground/30 ring-1 ring-foreground/20">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="https://media.woven.video/woven-hero-v2.png"
          width={2160}
          height={1198}
          aria-label="Woven app demo — chat-driven reel assembly"
          className="block h-auto w-full"
        >
          <source src="https://media.woven.video/woven-hero-v2.mp4" type="video/mp4" />
        </video>
      </div>
    </div>
  );
}

function MadeWithWoven() {
  return (
    <section
      id="made-with-woven"
      className="relative scroll-mt-20 py-24 md:py-32"
    >
      {/* edge-faded top divider */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, color-mix(in oklch, var(--foreground) 7%, transparent) 30%, color-mix(in oklch, var(--foreground) 7%, transparent) 70%, transparent)",
        }}
      />
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-2xl font-medium tracking-tight md:text-3xl">
            Made with Woven
          </h2>
          <p className="text-sm text-muted-foreground md:text-base">
            Real work shipped to Reels, TikTok, and Shorts.
          </p>
        </div>
        <div className="mt-14 -mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-[12%] pb-2 md:mx-0 md:grid md:grid-cols-5 md:gap-5 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {reels.map((reel, i) => (
            <div
              key={i}
              className="flex w-[76%] shrink-0 snap-center flex-col gap-3 md:w-auto md:shrink"
            >
              <ReelTile
                videoUrl={reel.videoUrl}
                posterUrl={reel.posterUrl}
                gradient={reel.gradient}
              />
              <p className="text-center text-sm text-muted-foreground">
                {reel.label}
              </p>
            </div>
          ))}
        </div>
      </div>
      {/* edge-faded bottom divider */}
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, color-mix(in oklch, var(--foreground) 7%, transparent) 30%, color-mix(in oklch, var(--foreground) 7%, transparent) 70%, transparent)",
        }}
      />
    </section>
  );
}

function Features() {
  return (
    <section
      id="features"
      className="relative scroll-mt-20 overflow-hidden border-y border-border/60 bg-card/40"
    >
      {/* diagonal hatching */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, color-mix(in oklch, var(--foreground) 4%, transparent) 0 1px, transparent 1px 14px)",
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-24 md:py-28">
        <div className="flex flex-col items-center gap-4 text-center">
          <SectionLabel>Features</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
            Built for the way you work.
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            Native, multimodal, chat-driven — with the model and key setup you
            choose.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featureCards.map((f) => (
            <Feature key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Feature({ icon: Icon, eyebrow, title, body }: FeatureCard) {
  return (
    <div className="group flex flex-col gap-3 rounded-3xl bg-card p-7 ring-1 ring-border transition-all hover:-translate-y-0.5 hover:ring-foreground/30 md:p-8">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        <Icon className="size-4 text-foreground" />
        {eyebrow}
      </div>
      <h3 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Pricing() {
  return (
    <section
      id="pricing"
      className="scroll-mt-20 border-b border-border/60"
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-24 md:py-28">
        <div className="flex flex-col items-center gap-4 text-center">
          <SectionLabel>Pricing</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
            Free to start. Pay for what you use.
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            Same Claude and GPT lineup either way. Use your own keys, or use
            Woven-hosted on a prepaid balance.
          </p>
        </div>
        <div className="mt-14 grid gap-5 text-left md:grid-cols-2">
          <div className="group flex flex-col gap-6 rounded-3xl bg-card p-8 ring-1 ring-border transition-all hover:-translate-y-0.5 hover:ring-foreground/30 md:p-10">
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-semibold tracking-tight">Free</h3>
              <p className="text-xs text-muted-foreground">
                Bring your own keys
              </p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-semibold tracking-[-0.04em] md:text-7xl">
                $0
              </span>
              <span className="text-sm text-muted-foreground">forever</span>
            </div>
            <p className="text-sm text-muted-foreground">
              The full app, running locally on your Mac. Pay providers directly.
            </p>
            <ul className="flex flex-col gap-3 border-t border-border pt-6 text-sm">
              <BulletItem>Runs entirely on your Mac</BulletItem>
              <BulletItem>Bring your own Anthropic and OpenAI keys</BulletItem>
              <BulletItem>You pay providers directly at their rates</BulletItem>
            </ul>
            <a
              href={DOWNLOAD_URL} download
              className={cn(
                buttonVariants({ variant: "outline" }),
                "mt-auto h-11 w-full rounded-full text-sm font-medium",
              )}
            >
              <AppleIcon className="size-4" />
              Download for Mac
            </a>
          </div>
          <div className="group relative flex flex-col gap-6 overflow-hidden rounded-3xl bg-foreground p-8 text-background ring-1 ring-foreground transition-shadow hover:shadow-2xl md:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-background/8 blur-3xl"
            />
            <div className="relative flex flex-col gap-1">
              <h3 className="text-base font-semibold tracking-tight">Hosted</h3>
              <p className="text-xs text-background/70">
                Pay as you go · No subscription
              </p>
            </div>
            <div className="relative flex items-baseline gap-2">
              <span className="text-6xl font-semibold tracking-[-0.04em] md:text-7xl">
                From $5
              </span>
              <span className="text-sm text-background/70">top up</span>
            </div>
            <p className="relative text-sm text-background/80">
              Sign in, top up your balance, and use Woven-hosted Claude and GPT
              — published per-model rates.
            </p>
            <ul className="relative flex flex-col gap-3 border-t border-background/15 pt-6 text-sm text-background/90">
              <BulletItem inverse>
                Top up a prepaid USD balance from $5
              </BulletItem>
              <BulletItem inverse>
                Hosted Claude Sonnet 4.6, Opus 4.7, Haiku 4.5, and GPT-5.5
              </BulletItem>
              <BulletItem inverse>
                Web search built in — flat per-call pricing
              </BulletItem>
              <BulletItem inverse>
                Charged per request at published rates
              </BulletItem>
            </ul>
            <Link
              href="/pricing"
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "relative mt-auto h-11 w-full rounded-full text-sm font-medium",
              )}
            >
              See per-model pricing
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function BulletItem({
  children,
  inverse = false,
}: {
  children: React.ReactNode;
  inverse?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          inverse
            ? "bg-background/15 text-background"
            : "bg-foreground text-background",
        )}
      >
        <CheckIcon className="size-3" />
      </span>
      <span>{children}</span>
    </li>
  );
}

function FAQ() {
  return (
    <section id="faq" className="scroll-mt-20 bg-card/40">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 md:py-28">
        <div className="grid gap-12 md:grid-cols-[1fr_1.4fr] md:gap-20">
          <div className="flex flex-col items-start gap-5">
            <SectionLabel>FAQs</SectionLabel>
            <h2 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
              Common questions.
            </h2>
            <p className="text-base text-muted-foreground">
              Anything else?{" "}
              <a
                href="mailto:hello@woven.video"
                className="text-foreground underline-offset-4 hover:underline"
              >
                hello@woven.video
              </a>
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Accordion>
              {faqs.map((item) => (
                <AccordionItem
                  key={item.q}
                  value={item.q}
                  className="mb-3 rounded-2xl border border-border bg-card px-5 transition-colors hover:border-foreground/20 not-last:border-b"
                >
                  <AccordionTrigger className="text-base hover:no-underline md:text-lg">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-muted-foreground">{item.a}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section
      id="download"
      className="relative overflow-hidden bg-foreground text-background"
    >
      {/* film grain */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay"
        style={{
          backgroundImage: "url('/noise.svg')",
          backgroundSize: "200px 200px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-background/12 blur-3xl"
      />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-6 py-32 text-center md:py-44">
        <h2 className="max-w-4xl text-5xl font-semibold tracking-[-0.035em] leading-[0.98] md:text-7xl lg:text-8xl">
          Make your next short form video.
        </h2>
        <p className="max-w-xl text-base text-background/70 md:text-lg">
          Download Woven, point it at your assets, and ship a vertical cut in
          an afternoon.
        </p>
        <Button
          nativeButton={false}
          variant="secondary"
          className="h-13 rounded-full px-8 text-base font-medium"
          render={<a href={DOWNLOAD_URL} download />}
        >
          <AppleIcon className="size-4" />
          Download for Mac
        </Button>
      </div>
    </section>
  );
}

