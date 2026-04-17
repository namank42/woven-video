import Image from "next/image";
import Link from "next/link";
import {
  CheckIcon,
  XIcon,
  ClockIcon,
  BoxIcon,
  ShapesIcon,
  UsersIcon,
  WandSparklesIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ReelTile } from "@/components/reel-tile";

const pillBtn = "h-11 rounded-full px-5 text-[0.9rem]";

const reels = [
  {
    label: "AI presenter",
    gradient: "from-zinc-900 via-zinc-700 to-zinc-500",
    videoUrl: "https://media.wovenlabs.net/woven-reels/no-caption-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/no-caption-poster.jpg",
  },
  {
    label: "Creator-style ad",
    gradient: "from-neutral-900 via-neutral-600 to-neutral-400",
    videoUrl: "https://media.wovenlabs.net/woven-reels/linger-brand-awareness-v13-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/linger-brand-awareness-v13-poster.jpg",
  },
  {
    label: "Lifestyle film",
    gradient: "from-slate-900 via-slate-700 to-slate-400",
    videoUrl: "https://media.wovenlabs.net/woven-reels/loft-showcase-v20-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/loft-showcase-v20-poster.jpg",
  },
  {
    label: "Animated story",
    gradient: "from-gray-900 via-gray-600 to-gray-300",
    videoUrl: "https://media.wovenlabs.net/woven-reels/theo-honesty-v10-web.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/theo-honesty-v10-poster.jpg",
  },
  {
    label: "Feature update",
    gradient: "from-stone-900 via-stone-700 to-stone-400",
    videoUrl: "https://media.wovenlabs.net/woven-reels/drift-demo-v31-full.mp4",
    posterUrl: "https://media.wovenlabs.net/woven-reels/drift-demo-v31-poster.jpg",
  },
];

const features = [
  {
    icon: WandSparklesIcon,
    title: "Generative AI assets",
    body: "Fresh footage, talent, b-roll, and spokespersons — generated to fit your brand, no shoots required.",
  },
  {
    icon: BoxIcon,
    title: "Or your existing assets",
    body: "Product shots, brand system, and raw footage you already have, transformed into polished reels.",
  },
  {
    icon: ShapesIcon,
    title: "Ads, content, launches",
    body: "The full commercial range — performance creative, UGC-style ads, feature drops, and campaign teasers.",
  },
  {
    icon: ClockIcon,
    title: "Fast turnaround",
    body: "Pilots delivered in around 5 business days. Monthly engagements run on rolling batches.",
  },
  {
    icon: UsersIcon,
    title: "No production overhead",
    body: "A systemized workflow replaces the bloat of a traditional agency or internal video team.",
  },
];

const processSteps = [
  { step: "01", title: "Send assets", body: "Share brand, product, and the launch you want to promote." },
  { step: "02", title: "We develop concepts", body: "We turn the brief into distinct reel directions." },
  { step: "03", title: "Production", body: "A systemized workflow built for speed and consistency." },
  { step: "04", title: "Review", body: "You send focused feedback inside a defined revision boundary." },
  { step: "05", title: "Delivery", body: "Final reels ready for Reels, TikTok, Shorts, and paid social." },
];

const builtFor = [
  "AI startups and software companies",
  "Consumer apps and SaaS tools",
  "Founder-led brands with active launches",
  "DTC and ecommerce with existing assets",
  "Teams that want more reels without hiring motion designers",
];

const notAFit = [
  "Full live-action production from scratch",
  "Unlimited bespoke creative or strategy work",
  "Long-form video and documentary work",
  "“Make us go viral” with no assets or clarity",
];

const pricing = [
  {
    name: "Launch Reel Sprint",
    tagline: "Pilot engagement",
    price: "$2,000",
    cadence: "one-time",
    description:
      "Three vertical reels for one campaign, launch, or feature. The easiest way to try Woven.",
    features: [
      "3 reels, 30–45 seconds each",
      "3 creative angles from one brief",
      "1 revision round per reel",
      "Delivered in ~5 business days",
    ],
    cta: "Book a call",
    highlighted: true,
  },
  {
    name: "Monthly",
    tagline: "Ongoing engagement",
    price: "From $5,000",
    cadence: "per month",
    description:
      "A steady stream of short-form reels for teams that need consistent output.",
    features: [
      "6 reels per month",
      "Mixed formats and use cases",
      "Rolling brief and feedback cycles",
      "Priority turnaround",
    ],
    cta: "Book a call",
    highlighted: false,
  },
  {
    name: "Custom",
    tagline: "For larger programs",
    price: "Let’s talk",
    cadence: "tailored",
    description:
      "Higher volume, dedicated capacity, or bespoke workflows for always-on creative programs.",
    features: [
      "Higher monthly output",
      "Dedicated production lanes",
      "Custom formats and asset libraries",
      "Direct line to the Woven team",
    ],
    cta: "Book a call",
    highlighted: false,
  },
];

const faqs = [
  {
    q: "What do you need from us to get started?",
    a: "Logo and brand guidelines, a link to your product or landing page, any footage or screenshots you have, and the key message, launch, or feature you want the reels to promote. The more clarity on the message, the faster we move.",
  },
  {
    q: "How fast is delivery?",
    a: "The Launch Reel Sprint delivers three reels in around five business days from the point we have your assets and brief. Monthly engagements run on rolling batches with priority turnaround.",
  },
  {
    q: "How do revisions work?",
    a: "Each reel in the pilot includes one revision round. The goal is tight, focused feedback — not open-ended changes. Monthly engagements operate on the same principle across rolling batches.",
  },
  {
    q: "Can you create reels with a spokesperson or influencer?",
    a: "Yes. We can produce face-led, spokesperson-style, and influencer-style creative using synthetic talent — no live shoot required.",
  },
  {
    q: "Who is Woven built for?",
    a: "Modern internet-native brands — AI and software companies, consumer apps, SaaS tools, founder-led startups, and DTC brands — that already have assets and want more short-form video without the overhead of a traditional agency or internal video team.",
  },
  {
    q: "Do you do long-form video, live shoots, or social media management?",
    a: "No. Woven is intentionally focused on short-form brand reels under 60 seconds. That’s how we stay fast and keep quality high.",
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
      "Woven is a short-form video studio that helps modern brands ship high-performing reels for ads and content using Generative AI.",
    slogan: "Short-form reels to grow your brand.",
  };

  const website = {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: "Woven",
    description:
      "Short-form reels for modern brands, with Generative AI.",
    inLanguage: "en-US",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  const service = {
    "@type": "Service",
    "@id": `${SITE_URL}/#service`,
    name: "Short-form brand reels",
    serviceType: "Short-form video production",
    provider: { "@id": `${SITE_URL}/#organization` },
    areaServed: "Worldwide",
    description:
      "Vertical short-form reels under 60 seconds for ads, content launches, and brand campaigns — produced using Generative AI and existing brand assets.",
    offers: pricing.map((tier) => {
      const base = {
        "@type": "Offer",
        name: tier.name,
        description: tier.description,
        category: tier.tagline,
        url: `${SITE_URL}/#pricing`,
      };
      const numeric = tier.price.match(/[\d,]+/);
      if (numeric) {
        return {
          ...base,
          price: numeric[0].replace(/,/g, ""),
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        };
      }
      return base;
    }),
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
    "@graph": [organization, website, service, faqPage],
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
      <main className="flex-1">
        <Hero />
        <ReelShowcase />
        <WhyWoven />
        <Process />
        <Fit />
        <PilotSpotlight />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <SiteFooter />
    </div>
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
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pt-8 pb-16 text-center md:pt-10 md:pb-20">
        <Image
          src="/woven-logo.png"
          alt="Woven"
          width={96}
          height={96}
          priority
          className="size-10"
        />
        <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-5xl">
          Short-form reels to grow your brand.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Woven helps{" "}
          <span className="font-medium text-orange-600">modern</span> brands
          consistently ship{" "}
          <span className="font-medium text-emerald-600">
            high-performing reels
          </span>{" "}
          for ads and content using{" "}
          <span className="font-medium text-violet-600">Generative AI</span>.
        </p>
        <Button
          nativeButton={false}
          className={`${pillBtn} mt-6`}
          render={<Link href="#pricing" />}
        >
          Book a call
        </Button>
      </div>
    </section>
  );
}

function ReelShowcase() {
  return (
    <section id="work" className="pb-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-[12%] pb-2 md:mx-0 md:grid md:grid-cols-5 md:gap-5 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {reels.map((reel) => (
            <div
              key={reel.label}
              className="w-[76%] shrink-0 snap-center md:w-auto md:shrink"
            >
              <ReelTile
                videoUrl={"videoUrl" in reel ? reel.videoUrl : undefined}
                posterUrl={"posterUrl" in reel ? reel.posterUrl : undefined}
                gradient={reel.gradient}
              />
              <p className="mt-3 text-center text-xs text-muted-foreground">
                {reel.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyWoven() {
  return (
    <section className="border-y border-border/60 bg-card/50">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 text-center">
        <div className="flex flex-col items-center gap-4">
          <SectionLabel>Why Woven</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
            Generated, adapted, or both.
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            We use generative AI to create fresh assets when you need them, and
            work from your existing brand system when you already have the raw
            material. Most projects use both.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-10">
          {features.slice(0, 3).map((f) => (
            <Feature key={f.title} {...f} />
          ))}
        </div>
        <div className="mt-12 grid grid-cols-1 gap-12 md:mx-auto md:max-w-3xl md:grid-cols-2 md:gap-10">
          {features.slice(3).map((f) => (
            <Feature key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-foreground text-background">
        <Icon className="size-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function Process() {
  return (
    <section id="process">
      <div className="mx-auto w-full max-w-6xl px-6 py-24 text-center">
        <div className="flex flex-col items-center gap-4">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
            A simple, fast process.
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            Five steps from brief to delivery — less painful than a traditional
            agency engagement.
          </p>
        </div>
        <div className="mt-16 grid gap-10 md:grid-cols-5 md:gap-5">
          {processSteps.map((s) => (
            <div key={s.step} className="flex flex-col items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full border border-border bg-card font-mono text-xs text-muted-foreground">
                {s.step}
              </div>
              <h3 className="text-base font-semibold tracking-tight">
                {s.title}
              </h3>
              <p className="max-w-[16rem] text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Fit() {
  return (
    <section className="border-y border-border/60 bg-card/50">
      <div className="mx-auto w-full max-w-5xl px-6 py-24 text-center">
        <div className="flex flex-col items-center gap-4">
          <SectionLabel>Who it’s for</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
            Built for modern brands. Narrow on purpose.
          </h2>
        </div>
        <div className="mt-14 grid gap-5 text-left md:grid-cols-2">
          <div className="rounded-2xl bg-card p-8 ring-1 ring-border">
            <h3 className="text-lg font-semibold tracking-tight">Built for</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Teams already shipping, who want more reels.
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {builtFor.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                    <CheckIcon className="size-3" />
                  </span>
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-card p-8 ring-1 ring-border">
            <h3 className="text-lg font-semibold tracking-tight">Not a fit</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Staying narrow is how we stay fast.
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {notAFit.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <XIcon className="size-3" />
                  </span>
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function PilotSpotlight() {
  return (
    <section>
      <div className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="overflow-hidden rounded-3xl bg-foreground text-background">
          <div className="flex flex-col items-center gap-8 px-8 py-16 text-center md:px-16 md:py-20">
            <div className="inline-flex items-center gap-2 rounded-full bg-background/10 px-3 py-1 text-xs font-medium text-background/90 ring-1 ring-background/15">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Pilot engagement
            </div>
            <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-6xl">
              The Launch Reel Sprint.
            </h2>
            <p className="max-w-2xl text-base leading-relaxed text-background/70 md:text-lg">
              A fixed-scope way to try Woven. Three polished reels built around
              one launch, feature, or campaign — using the assets you already
              have.
            </p>
            <div className="mt-2 grid w-full max-w-3xl grid-cols-2 gap-x-6 gap-y-3 text-left text-sm text-background/80 md:grid-cols-3">
              {[
                "3 vertical reels, 30–45s",
                "3 creative angles",
                "1 revision round per reel",
                "Delivered in ~5 business days",
                "Built from your assets",
                "Starting at $2,000",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  {item}
                </div>
              ))}
            </div>
            <Button
              nativeButton={false}
              variant="secondary"
              className={`${pillBtn} mt-2`}
              render={<Link href="#pricing" />}
            >
              Book a call
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="border-y border-border/60 bg-card/50">
      <div className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="flex flex-col items-center gap-4 text-center">
          <SectionLabel>Pricing</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
            Start small. Scale when it works.
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            Most clients start with a pilot, then move to a monthly engagement
            once they see the output.
          </p>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {pricing.map((tier) => (
            <div
              key={tier.name}
              className={
                tier.highlighted
                  ? "relative flex flex-col gap-6 rounded-3xl bg-card p-8 ring-2 ring-foreground"
                  : "relative flex flex-col gap-6 rounded-3xl bg-card p-8 ring-1 ring-border"
              }
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    Most popular
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold tracking-tight">
                  {tier.name}
                </h3>
                <p className="text-xs text-muted-foreground">{tier.tagline}</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight">
                  {tier.price}
                </span>
                <span className="text-sm text-muted-foreground">
                  {tier.cadence}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {tier.description}
              </p>
              <ul className="flex flex-col gap-2.5 border-t border-border pt-6">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2.5 text-sm text-foreground"
                  >
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                nativeButton={false}
                variant={tier.highlighted ? "default" : "outline"}
                className={`${pillBtn} mt-auto w-full`}
                render={<Link href="#book" />}
              >
                {tier.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section id="faq">
      <div className="mx-auto w-full max-w-3xl px-6 py-24">
        <div className="flex flex-col items-center gap-4 text-center">
          <SectionLabel>FAQs</SectionLabel>
          <h2 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
            Common questions.
          </h2>
        </div>
        <div className="mt-12 flex flex-col gap-3">
          <Accordion>
            {faqs.map((item) => (
              <AccordionItem
                key={item.q}
                value={item.q}
                className="mb-3 rounded-2xl border border-border bg-card px-5 not-last:border-b"
              >
                <AccordionTrigger className="text-base hover:no-underline">
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
    </section>
  );
}

function FinalCTA() {
  return (
    <section id="book" className="border-t border-border/60 bg-card/50">
      <div className="mx-auto w-full max-w-4xl px-6 py-28 text-center md:py-36">
        <div className="flex flex-col items-center gap-8">
          <h2 className="max-w-3xl text-5xl font-semibold tracking-[-0.03em] leading-[1.02] md:text-7xl">
            Let’s make the reels.
          </h2>
          <p className="max-w-xl text-base text-muted-foreground md:text-lg">
            Book a short call. We’ll look at your assets, what you’re shipping,
            and whether a Launch Reel Sprint is the right next step.
          </p>
          <Button
            nativeButton={false}
            className={pillBtn}
            render={<Link href="#book" />}
          >
            Book a call
          </Button>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-10 text-center md:flex-row md:justify-between md:text-left">
        <div className="flex items-center gap-3">
          <Image
            src="/woven-logo.png"
            alt="Woven"
            width={100}
            height={28}
            className="h-5 w-auto"
          />
          <span className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Woven. All rights reserved.
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#work" className="hover:text-foreground">
            Work
          </a>
          <a href="#process" className="hover:text-foreground">
            Process
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <a href="#faq" className="hover:text-foreground">
            FAQ
          </a>
        </div>
      </div>
    </footer>
  );
}
