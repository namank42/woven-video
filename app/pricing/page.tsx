import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  AppleIcon,
  ArrowRightIcon,
  CheckIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/utils";

const DOWNLOAD_URL = "https://release.woven.video/Woven.dmg";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Woven is free to download with your own provider keys. Use Woven-hosted Claude and GPT models on a prepaid balance with published per-model rates.",
  alternates: { canonical: "/pricing" },
};

type ModelRate = {
  name: string;
  modelId: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

type ToolRate = {
  name: string;
  description: string;
  perCall: string;
  per1k: string;
};

const models: ModelRate[] = [
  {
    name: "Claude Sonnet 4.6",
    modelId: "anthropic/claude-sonnet-4.6",
    input: "$3.60/M",
    output: "$18.00/M",
    cacheRead: "$0.36/M",
    cacheWrite: "$4.50/M",
  },
  {
    name: "Claude Opus 4.7",
    modelId: "anthropic/claude-opus-4.7",
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
];

const tools: ToolRate[] = [
  {
    name: "Web Search",
    description: "Searches the web for current info.",
    perCall: "$0.012",
    per1k: "$12.00",
  },
  {
    name: "Web Fetch",
    description: "Reads a webpage.",
    perCall: "$0.006",
    per1k: "$6.00",
  },
];

const localBullets = [
  "Native macOS app, runs entirely on your Mac",
  "Bring your own Anthropic and OpenAI keys",
  "You pay providers directly at their rates",
];

const hostedBullets = [
  "Top up a prepaid USD balance from $5",
  "All Woven-hosted models, ready to go — no key management",
  "Web search built in — flat per-call pricing",
  "Charged per request at the rates below",
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <PricingHero />
        <Plans />
        <ModelsTable />
        <ToolsTable />
        <Notes />
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
          Free to start. Pay for what you use.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Free with your own keys. Or top up to use Woven-hosted models with
          published per-model rates. No subscriptions, no minimums.
        </p>
      </div>
    </section>
  );
}

function Plans() {
  return (
    <section className="pb-12">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-5 rounded-3xl bg-card p-8 ring-1 ring-border">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Free</h2>
              <p className="text-xs text-muted-foreground">Bring your own keys</p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">$0</span>
              <span className="text-sm text-muted-foreground">forever</span>
            </div>
            <p className="text-sm text-muted-foreground">
              The full app, running locally on your Mac. Pay providers directly.
            </p>
            <ul className="mt-2 flex flex-col gap-3 border-t border-border pt-6 text-sm">
              {localBullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <CheckIcon className="size-3" />
                  </span>
                  <span>{b}</span>
                </li>
              ))}
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
          <div className="flex flex-col gap-5 rounded-3xl bg-card p-8 ring-2 ring-foreground">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">Hosted</h2>
              <p className="text-xs text-muted-foreground">Pay-as-you-go</p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold tracking-tight">From $5</span>
              <span className="text-sm text-muted-foreground">top up</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Sign in, top up a prepaid USD balance, and use any Woven-hosted
              model at the rates listed below.
            </p>
            <ul className="mt-2 flex flex-col gap-3 border-t border-border pt-6 text-sm">
              {hostedBullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                    <CheckIcon className="size-3" />
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/login?next=/account"
              className={cn(
                buttonVariants(),
                "mt-auto h-11 w-full rounded-full text-sm font-medium",
              )}
            >
              Sign in to top up
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>
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
              {models.map((m) => (
                <tr key={m.modelId}>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{m.name}</span>
                      <code className="font-mono text-xs text-muted-foreground">
                        {m.modelId}
                      </code>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums">{m.input}</td>
                  <td className="px-6 py-4 text-right tabular-nums">{m.output}</td>
                  <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                    {m.cacheRead}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                    {m.cacheWrite}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 md:hidden">
          {models.map((m) => (
            <div
              key={m.modelId}
              className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{m.name}</span>
                <code className="font-mono text-xs text-muted-foreground">
                  {m.modelId}
                </code>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Input</dt>
                <dd className="text-right tabular-nums">{m.input}</dd>
                <dt className="text-muted-foreground">Output</dt>
                <dd className="text-right tabular-nums">{m.output}</dd>
                <dt className="text-muted-foreground">Cache read</dt>
                <dd className="text-right tabular-nums">{m.cacheRead}</dd>
                <dt className="text-muted-foreground">Cache write</dt>
                <dd className="text-right tabular-nums">{m.cacheWrite}</dd>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
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
            Flat per-call pricing, deducted from your prepaid balance.
          </p>
        </div>

        <div className="hidden overflow-hidden rounded-2xl ring-1 ring-border md:block">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-4 font-medium">Tool</th>
                <th className="px-6 py-4 text-right font-medium">Per call</th>
                <th className="px-6 py-4 text-right font-medium">Per 1k calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {tools.map((t) => (
                <tr key={t.name}>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{t.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.description}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums">{t.perCall}</td>
                  <td className="px-6 py-4 text-right tabular-nums text-muted-foreground">
                    {t.per1k}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 md:hidden">
          {tools.map((t) => (
            <div
              key={t.name}
              className="flex flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-border"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Per call</dt>
                <dd className="text-right tabular-nums">{t.perCall}</dd>
                <dt className="text-muted-foreground">Per 1k calls</dt>
                <dd className="text-right tabular-nums">{t.per1k}</dd>
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
            Model requests are charged per token used; tool calls are flat
            per-call. Both deduct from the same prepaid balance.
          </NoteCard>
          <NoteCard title="Bring your own keys instead">
            Prefer to use your own provider keys? Run Woven locally for free —
            no Woven account and no balance to manage. You pay providers
            directly.
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
          Start with the local app.
        </h2>
        <p className="max-w-xl text-base text-muted-foreground md:text-lg">
          Free download. Bring your keys. Top up later if you want hosted models.
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

