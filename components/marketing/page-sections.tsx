import Link from "next/link";
import { AppleIcon, ArrowRightIcon } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button, buttonVariants } from "@/components/ui/button";
import { DOWNLOAD_URL, SITE_CONTENT_UPDATED } from "@/lib/seo/constants";
import type { FaqItem } from "@/lib/seo/faqs";
import type { ComparisonRow, RoundupEntry } from "@/lib/seo/landing-pages";
import { cn } from "@/lib/utils";

export function AnswerFirst({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-base leading-relaxed text-muted-foreground md:text-lg">{children}</p>
  );
}

export function Verdict({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl bg-card px-5 py-4 text-sm leading-relaxed ring-1 ring-border md:text-base">
      <span className="font-medium text-foreground">Bottom line: </span>
      {children}
    </p>
  );
}

export function LastUpdated() {
  return (
    <p className="text-sm text-muted-foreground">Last updated {SITE_CONTENT_UPDATED}</p>
  );
}

export function FaqSection({ faqs, title = "Common questions" }: { faqs: FaqItem[]; title?: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <Accordion>
        {faqs.map((item) => (
          <AccordionItem
            key={item.q}
            value={item.q}
            className="mb-3 rounded-2xl border border-border bg-card px-5 not-last:border-b"
          >
            <AccordionTrigger className="text-base hover:no-underline">{item.q}</AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground">{item.a}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

export function ComparisonTable({
  competitorName,
  rows,
}: {
  competitorName: string;
  rows: ComparisonRow[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-border">
      <table className="w-full text-sm">
        <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-5 py-4 font-medium">Feature</th>
            <th className="px-5 py-4 font-medium">Woven</th>
            <th className="px-5 py-4 font-medium">{competitorName}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.feature}>
              <td className="px-5 py-4 font-medium">{row.feature}</td>
              <td className="px-5 py-4 text-muted-foreground">{row.woven}</td>
              <td className="px-5 py-4 text-muted-foreground">{row.competitor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChooseLists({
  competitorName,
  chooseWoven,
  chooseCompetitor,
}: {
  competitorName: string;
  chooseWoven: string[];
  chooseCompetitor: string[];
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 ring-1 ring-border">
        <h3 className="font-semibold">Choose Woven if…</h3>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {chooseWoven.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-foreground">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 ring-1 ring-border">
        <h3 className="font-semibold">Choose {competitorName} if…</h3>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {chooseCompetitor.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-foreground">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function WorkflowSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-4 text-sm leading-relaxed md:text-base">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
            {i + 1}
          </span>
          <span className="pt-0.5 text-muted-foreground">{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function HighlightCards({ items }: { items: { title: string; body: string }[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.title} className="flex flex-col gap-2 rounded-2xl bg-card p-6 ring-1 ring-border">
          <h3 className="font-semibold">{item.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

export function RoundupTable({ entries }: { entries: RoundupEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-5 py-4 font-medium">Tool</th>
            <th className="px-5 py-4 font-medium">Best for</th>
            <th className="px-5 py-4 font-medium">Platform</th>
            <th className="px-5 py-4 font-medium">Pricing</th>
            <th className="px-5 py-4 font-medium">Highlight</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry) => (
            <tr key={entry.name}>
              <td className="px-5 py-4 font-medium">{entry.name}</td>
              <td className="px-5 py-4 text-muted-foreground">{entry.bestFor}</td>
              <td className="px-5 py-4 text-muted-foreground">{entry.platform}</td>
              <td className="px-5 py-4 text-muted-foreground">{entry.pricing}</td>
              <td className="px-5 py-4 text-muted-foreground">{entry.highlight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarketingCta({
  heading = "Try Woven free for 7 days",
  body = "Then $99/year. Native Mac app for short-form video.",
}: {
  heading?: string;
  body?: string;
}) {
  return (
    <section className="rounded-3xl bg-foreground px-8 py-10 text-background md:px-10">
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{heading}</h2>
          <p className="text-sm text-background/70 md:text-base">{body}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            nativeButton={false}
            variant="secondary"
            className="h-11 rounded-full px-6"
            render={<a href={DOWNLOAD_URL} download />}
          >
            <AppleIcon className="size-4" />
            Download for Mac
          </Button>
          <Link
            href="/login?next=/account"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-11 rounded-full border-background/30 bg-transparent px-6 text-background hover:bg-background/10 hover:text-background",
            )}
          >
            Start free trial
            <ArrowRightIcon className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function RelatedLinks() {
  const links = [
    { href: "/vs/capcut", label: "CapCut alternative" },
    { href: "/vs/descript", label: "Descript alternative" },
    { href: "/ai-video-editor-mac", label: "AI video editor for Mac" },
    { href: "/for/reels", label: "AI Reels maker" },
    { href: "/pricing", label: "Pricing" },
  ];

  return (
    <section className="flex flex-col gap-3 border-t border-border/60 pt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Related
      </h2>
      <div className="flex flex-wrap gap-4 text-sm">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-foreground underline underline-offset-4 hover:no-underline"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}