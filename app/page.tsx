import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  AppleIcon,
  BadgeCheckIcon,
  CalendarIcon,
  CheckIcon,
  WalletIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ReelTile } from "@/components/reel-tile";
import { CaptionSwitcher } from "@/components/caption-switcher";
import { TransitionSwitcher } from "@/components/transition-switcher";
import { TextAnimationSwitcher } from "@/components/text-animation-switcher";
import { AgentEditPreview } from "@/components/agent-edit-preview";
import { SfxSoundboard } from "@/components/sfx-soundboard";
import { JsonLd } from "@/components/seo/json-ld";
import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { WhatsNewLink } from "@/components/whats-new-link";
import {
  ANSWER_FIRST_HOMEPAGE,
  DOWNLOAD_URL,
} from "@/lib/seo/constants";
import { homepageFaqs } from "@/lib/seo/faqs";
import { homePageGraph } from "@/lib/seo/schema";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { alternates: { canonical: "/", types: { "text/markdown": "/index.md" } } };

const BOOK_DEMO_URL = "https://cal.com/naman-woven/45min";

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

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <JsonLd data={homePageGraph(homepageFaqs)} />
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
        <WhatsNewLink />
        <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-5xl lg:text-6xl">
          The AI Video Editor
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          {ANSWER_FIRST_HOMEPAGE}
        </p>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Script. Shot list. Generate. Animate. Edit. Assemble — all in one place.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Button
            nativeButton={false}
            className="h-12 rounded-full px-7 text-base font-medium shadow-lg shadow-foreground/10"
            render={<a href={DOWNLOAD_URL} download />}
          >
            <AppleIcon className="size-4" />
            Download for Mac
          </Button>
          <Button
            nativeButton={false}
            variant="outline"
            className="h-12 rounded-full px-6 text-base font-medium"
            render={
              <a
                href={BOOK_DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <CalendarIcon className="size-4" />
            Book a demo
          </Button>
        </div>
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
          poster="https://media.woven.video/woven-hero-v6.png"
          width={2000}
          height={1078}
          aria-label="Woven app demo — chat-driven reel assembly"
          className="block h-auto w-full"
        >
          <source src="https://media.woven.video/woven-hero-v6-60fps.mp4" type="video/mp4" />
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
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, color-mix(in oklch, var(--foreground) 4%, transparent) 0 1px, transparent 1px 14px)",
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-16 md:py-28">
        <div className="flex flex-col items-center gap-4 text-center">
          <SectionLabel>Features</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] text-balance md:text-5xl">
            The details that make the edit.
          </h2>
        </div>
        <div className="mt-12 flex flex-col gap-12">
          <AgentEditShowcase />
          <SectionDivider />
          <div className="grid grid-cols-1 gap-x-12 gap-y-6 lg:grid-cols-2">
            <CaptionShowcase />
            <TransitionShowcase />
          </div>
          <SectionDivider />
          <div className="grid grid-cols-1 gap-x-12 gap-y-6 lg:grid-cols-2">
            <TextAnimationShowcase />
            <SfxShowcase />
          </div>
        </div>
        <div className="mt-12 flex flex-col items-center gap-2 text-center md:mt-16">
          <p className="text-base text-muted-foreground">
            And more to make it yours.
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionDivider() {
  return (
    <div
      aria-hidden="true"
      className="h-px"
      style={{
        background:
          "linear-gradient(to right, transparent, color-mix(in oklch, var(--foreground) 12%, transparent) 20%, color-mix(in oklch, var(--foreground) 12%, transparent) 80%, transparent)",
      }}
    />
  );
}

function ShowcaseHeader({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-2 text-left">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <h3 className="text-2xl font-semibold tracking-tight text-balance">
        {title}
      </h3>
      <p className="max-w-[45ch] text-base leading-relaxed text-muted-foreground text-pretty">
        {body}
      </p>
    </div>
  );
}

function AgentEditShowcase() {
  return (
    <div className="flex flex-col gap-6">
      <ShowcaseHeader
        label="AI editing"
        title="Describe the edit. Watch it happen."
        body="Tell Woven what you want. Keep refining in chat or make adjustments on the timeline."
      />
      <AgentEditPreview />
    </div>
  );
}

function CaptionShowcase() {
  return (
    <div className="grid grid-cols-1 gap-6 max-lg:mb-8 lg:row-span-3 lg:grid-rows-subgrid">
      <ShowcaseHeader
        label="Captions"
        title="Your words. Your style."
        body="Highlight each word, build a line as you speak, or keep it simple with classic subtitles."
      />
      <CaptionSwitcher />
    </div>
  );
}

function TransitionShowcase() {
  return (
    <div className="grid grid-cols-1 gap-6 max-lg:mb-8 lg:row-span-3 lg:grid-rows-subgrid">
      <ShowcaseHeader
        label="Transitions"
        title="Set the pace between shots."
        body="Go subtle with a fade or make the cut with a whip, flash, or glitch."
      />
      <TransitionSwitcher />
    </div>
  );
}

function TextAnimationShowcase() {
  return (
    <div className="grid grid-cols-1 gap-6 max-lg:mb-8 lg:row-span-3 lg:grid-rows-subgrid">
      <ShowcaseHeader
        label="Text animation"
        title="Give your text an entrance."
        body="Pop it in, reveal it word by word, or keep it moving with a loop."
      />
      <TextAnimationSwitcher />
    </div>
  );
}

function SfxShowcase() {
  return (
    <div className="grid grid-cols-1 gap-6 max-lg:mb-8 lg:row-span-3 lg:grid-rows-subgrid">
      <ShowcaseHeader
        label="Sound effects"
        title="Make the moment land."
        body="Add a whoosh to a transition, a pop to a reveal, or an impact to the punchline."
      />
      <SfxSoundboard />
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
            Try it free for 3 days.
          </h2>
        </div>
        <div className="mx-auto mt-14 w-full max-w-xl text-left">
          {/* Required base: the Woven subscription */}
          <div className="group relative flex flex-col gap-6 overflow-hidden rounded-3xl bg-foreground p-8 text-background ring-1 ring-foreground transition-shadow hover:shadow-2xl md:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-background/8 blur-3xl"
            />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold tracking-tight">
                  Woven
                </h3>
                <p className="text-xs text-background/70">
                  3-day free trial
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground">
                Required
              </span>
            </div>
            <div className="relative flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-6xl font-semibold tracking-[-0.04em] md:text-7xl">
                  $8.25
                </span>
                <span className="text-sm text-background/70">/mo</span>
              </div>
              <p className="text-sm text-background/70">
                billed annually at $99/yr
              </p>
            </div>
            <p className="relative text-sm text-background/80">
              The full Woven app on your Mac, free for 3 days. Includes $5 in
              hosted credits to start.
            </p>
            <ul className="relative flex flex-col gap-3 border-t border-background/15 pt-6 text-sm text-background/90">
              <BulletItem inverse>
                Sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan
              </BulletItem>
              <BulletItem inverse>$5 in Woven-hosted credits to start</BulletItem>
            </ul>
            <Button
              nativeButton={false}
              variant="secondary"
              className="relative mt-auto h-11 w-full rounded-full text-sm font-medium"
              render={<a href={DOWNLOAD_URL} download />}
            >
              <AppleIcon className="size-4" />
              Download for Mac
            </Button>
            <div className="relative flex items-start justify-center gap-1.5">
              <BadgeCheckIcon className="mt-0.5 size-4 shrink-0 text-green-400" />
              <p className="max-w-xs text-xs text-background/70">
                <span className="font-medium text-background">$0 due today</span>{" "}
                · cancel anytime before day 3 · card required.
              </p>
            </div>
          </div>

          {/* Optional add-on: hosted credits, layered on top */}
          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-card p-6 ring-1 ring-border">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                  <WalletIcon className="size-4" />
                </span>
                <div className="flex flex-col">
                  <h3 className="text-sm font-semibold tracking-tight">
                    Hosted credits
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Optional · pay-as-you-go
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-3 py-1 text-sm font-medium tabular-nums">
                From $5
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Top up a prepaid balance anytime to run Woven-hosted models —
              layered on top of your license, no key management.{" "}
              <Link
                href="/pricing"
                className="font-medium text-foreground underline underline-offset-4"
              >
                See per-model pricing →
              </Link>
            </p>
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
              Still have questions?{" "}
              <Link
                href="/contact"
                className="text-foreground underline underline-offset-4 hover:no-underline"
              >
                Contact us
              </Link>{" "}
              or email{" "}
              <a
                href="mailto:hello@woven.video"
                className="text-foreground underline underline-offset-4 hover:no-underline"
              >
                hello@woven.video
              </a>
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <noscript>
              <style>{`.homepage-faq-interactive { display: none; }`}</style>
              {homepageFaqs.map(item => (
                <section key={item.q} className="mb-3 rounded-2xl border border-border bg-card px-5 py-3">
                  <h3 className="text-base font-medium md:text-lg">{item.q}</h3>
                  <p className="mt-3 text-muted-foreground">{item.a}</p>
                </section>
              ))}
            </noscript>
            <Accordion className="homepage-faq-interactive">
              {homepageFaqs.map((item) => (
                <AccordionItem
                  key={item.q}
                  value={item.q}
                  className="mb-3 rounded-2xl border border-border bg-card px-5 transition-colors hover:border-foreground/20 not-last:border-b"
                >
                  <AccordionTrigger className="text-base hover:no-underline md:text-lg">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent keepMounted>
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
        <p className="text-sm text-background/60">
          Questions before you download?{" "}
          <Link
            href="/contact"
            className="text-background underline underline-offset-4"
          >
            Get in touch
          </Link>
        </p>
      </div>
    </section>
  );
}
