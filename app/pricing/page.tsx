import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  AppleIcon,
  BadgeCheckIcon,
  CheckIcon,
  WalletIcon,
} from "lucide-react";

import { FaqSection, LastUpdated } from "@/components/marketing/page-sections";
import { JsonLd } from "@/components/seo/json-ld";
import { Button } from "@/components/ui/button";
import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import {
  chatModelRates,
  featureRates,
  mediaModelRates,
} from "@/lib/pricing-page-rates";
import { ANSWER_FIRST_PRICING, DOWNLOAD_URL } from "@/lib/seo/constants";
import { pricingFaqs } from "@/lib/seo/faqs";
import { pricingPageGraph } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Woven is a native macOS AI video editor. Try free for 7 days, then $8.25/mo, billed annually ($99/yr) — cancel anytime. Includes $5 in hosted credits. Run any model your way: bring your own Anthropic/OpenAI keys, sign in with ChatGPT, or top up Woven-hosted credits at published per-model rates.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <JsonLd data={pricingPageGraph(pricingFaqs)} />
      <SiteHeader />
      <main className="flex-1">
        <PricingHero />
        <Plans />
        <ModelsTable />
        <ToolsTable />
        <Notes />
        <section className="border-t border-border/60 py-16">
          <div className="mx-auto w-full max-w-3xl px-6">
            <FaqSection faqs={pricingFaqs} title="Pricing FAQs" />
            <div className="mt-6">
              <LastUpdated />
            </div>
          </div>
        </section>
        <CtaBand />
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
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/pricing" className="text-foreground">
            Pricing
          </Link>
          <Link href="/#faq" className="hover:text-foreground">
            FAQ
          </Link>
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

function PricingHero() {
  return (
    <section>
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-16 pb-10 text-center md:pt-20">
        <SectionLabel>Pricing</SectionLabel>
        <h1 className="mt-6 max-w-2xl text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-6xl">
          Try Woven free for 7 days.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          {ANSWER_FIRST_PRICING}
        </p>
      </div>
    </section>
  );
}

function Plans() {
  const licenseBullets = [
    "Bring your own Anthropic and OpenAI keys",
    "Or sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",
    "$5 in Woven-hosted credits to start",
  ];

  return (
    <section className="pb-12">
      <div className="mx-auto w-full max-w-xl px-6">
        {/* Required base: the Woven subscription */}
        <div className="flex flex-col gap-5 rounded-3xl bg-card p-8 ring-2 ring-foreground">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Woven</h2>
              <p className="text-xs text-muted-foreground">7-day free trial</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
              Required
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">$8.25</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
            <p className="text-sm text-muted-foreground">
              billed annually at $99/yr
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            The full Woven app, free for 7 days. Includes $5 in hosted credits to
            start.
          </p>
          <ul className="mt-2 flex flex-col gap-3 border-t border-border pt-6 text-sm">
            {licenseBullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <CheckIcon className="size-3" />
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <Button
            nativeButton={false}
            className="mt-auto h-11 w-full rounded-full text-sm font-medium"
            render={<a href={DOWNLOAD_URL} download />}
          >
            <AppleIcon className="size-4" />
            Download for Mac
          </Button>
          <div className="flex items-start justify-center gap-1.5">
            <BadgeCheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" />
            <p className="max-w-xs text-xs text-muted-foreground">
              <span className="font-medium text-foreground">$0 due today</span> ·
              cancel anytime before day 7 · card required. We email you before
              your trial ends.
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
            Top up a prepaid balance anytime to run Woven-hosted models — layered on
            top of your license, no key management.{" "}
            <Link
              href="#models"
              className="font-medium text-foreground underline underline-offset-4"
            >
              See per-model rates ↓
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function ModelsTable() {
  return (
    <section id="models" className="pb-16">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="flex flex-col gap-2 pb-8">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Hosted model rates
          </h2>
          <p className="text-sm text-muted-foreground md:text-base">
            All prices in USD. Charges are deducted from your prepaid balance.
          </p>
        </div>

        <RateGroupHeader
          title="Chat models"
          description="Token pricing for hosted text models."
        />
        <ChatModelsTable />

        <div className="mt-10">
          <RateGroupHeader
            title="Media models"
            description="Image, video, and music generation pricing for Woven-hosted credits."
          />
        </div>
        <MediaModelsTable />
      </div>
    </section>
  );
}

function RateGroupHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1 pb-4">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ChatModelsTable() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl ring-1 ring-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-6 py-4 font-medium">Model</th>
              <th className="px-6 py-4 text-right font-medium">Input</th>
              <th className="px-6 py-4 text-right font-medium">Output</th>
              <th className="px-6 py-4 text-right font-medium">Cache read</th>
              <th className="px-6 py-4 text-right font-medium">Cache write</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {chatModelRates.map((model) => (
              <tr key={model.modelId}>
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {model.name}
                    </span>
                    <code className="font-mono text-xs text-muted-foreground">
                      {model.modelId}
                    </code>
                  </div>
                </td>
                <td className="px-6 py-4 text-right tabular-nums">
                  {model.input}
                </td>
                <td className="px-6 py-4 text-right tabular-nums">
                  {model.output}
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                  {model.cacheRead}
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                  {model.cacheWrite}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {chatModelRates.map((model) => (
          <div
            key={model.modelId}
            className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{model.name}</span>
              <code className="font-mono text-xs text-muted-foreground">
                {model.modelId}
              </code>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Input</dt>
              <dd className="text-right tabular-nums">{model.input}</dd>
              <dt className="text-muted-foreground">Output</dt>
              <dd className="text-right tabular-nums">{model.output}</dd>
              <dt className="text-muted-foreground">Cache read</dt>
              <dd className="text-right tabular-nums">{model.cacheRead}</dd>
              <dt className="text-muted-foreground">Cache write</dt>
              <dd className="text-right tabular-nums">{model.cacheWrite}</dd>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function MediaModelsTable() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl ring-1 ring-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-[28%] px-6 py-4 font-medium">Model</th>
              <th className="w-[18%] px-6 py-4 font-medium">Capability</th>
              <th className="w-[28%] px-6 py-4 text-right font-medium">Rate</th>
              <th className="w-[26%] px-6 py-4 text-right font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {mediaModelRates.map((model) => (
              <tr key={model.name}>
                <td className="px-6 py-4 align-top">
                  <span className="font-medium text-foreground">
                    {model.name}
                  </span>
                </td>
                <td className="px-6 py-4 align-top text-muted-foreground">
                  {model.capability}
                </td>
                <td className="px-6 py-4 text-right align-top tabular-nums">
                  {model.rate}
                </td>
                <td className="px-6 py-4 text-right align-top text-muted-foreground">
                  {model.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {mediaModelRates.map((model) => (
          <div
            key={model.name}
            className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
          >
            <div className="flex flex-col gap-1.5">
              <span className="font-medium">{model.name}</span>
            </div>
            <dl className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Capability</dt>
              <dd className="text-right">{model.capability}</dd>
              <dt className="text-muted-foreground">Rate</dt>
              <dd className="text-right tabular-nums">{model.rate}</dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="text-right text-muted-foreground">{model.notes}</dd>
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function ToolsTable() {
  return (
    <section id="tools" className="pb-16">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="flex flex-col gap-2 pb-8">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Other features
          </h2>
          <p className="text-sm text-muted-foreground md:text-base">
            Usage-based and flat feature pricing, deducted from your prepaid
            balance.
          </p>
        </div>

        <div className="hidden overflow-hidden rounded-2xl ring-1 ring-border md:block">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-4 font-medium">Feature</th>
                <th className="px-6 py-4 text-right font-medium">Rate</th>
                <th className="px-6 py-4 text-right font-medium">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {featureRates.map((feature) => (
                <tr key={feature.name}>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {feature.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {feature.description}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums">
                    {feature.rate}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                    {feature.reference}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 md:hidden">
          {featureRates.map((feature) => (
            <div
              key={feature.name}
              className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{feature.name}</span>
                <span className="text-xs text-muted-foreground">
                  {feature.description}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Rate</dt>
                <dd className="text-right tabular-nums">{feature.rate}</dd>
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="text-right tabular-nums">{feature.reference}</dd>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Notes() {
  return (
    <section className="border-t border-border/60 bg-card/50">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="grid gap-8 md:grid-cols-3">
          <NoteCard title="Top up from $5">
            Top-ups available at $5, $10, $20, $50 — or any custom amount up
            to $100. Balance is denominated in USD and never expires.
          </NoteCard>
          <NoteCard title="Per-request billing">
            Model requests are charged per token used; media features are
            usage-based; tool calls are flat per-call. All deduct from the same
            prepaid balance.
          </NoteCard>
          <NoteCard title="Use your own keys">
            Your license covers the full app whether you bring your own Anthropic/
            OpenAI keys (pay providers directly) or sign in with ChatGPT. Hosted
            credits are only needed for Woven-hosted models.
          </NoteCard>
        </div>
      </div>
    </section>
  );
}

function NoteCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

function CtaBand() {
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
          Try it free for 7 days.
        </h2>
        <p className="max-w-xl text-base text-muted-foreground md:text-lg">
          Then $8.25/mo, billed annually ($99/yr). Cancel anytime. $5 in hosted credits to start.
        </p>
        <Button
          nativeButton={false}
          className="h-12 rounded-full px-7 text-base font-medium"
          render={<a href={DOWNLOAD_URL} download />}
        >
          <AppleIcon className="size-4" />
          Download for Mac
        </Button>
      </div>
    </section>
  );
}
