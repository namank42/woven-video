import type { Metadata } from "next";
import type { ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";

import { LastUpdated } from "@/components/marketing/page-sections";
import { JsonLd } from "@/components/seo/json-ld";
import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { getReleases, type Release } from "@/lib/changelog";
import { changelogEntries } from "@/lib/changelog-content";
import { changelogPageGraph } from "@/lib/seo/schema";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Every update to the Woven app — new features, improvements, and fixes, newest first.",
  alternates: { canonical: "/changelog" },
};

type ResolvedEntry = {
  release: Release;
  Body: ComponentType | null;
  title?: string;
};

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function resolveEntries(releases: Release[]): Promise<ResolvedEntry[]> {
  return Promise.all(
    releases.map(async (release) => {
      const loader = changelogEntries[release.version];
      if (!loader) return { release, Body: null };
      const mod = await loader();
      return { release, Body: mod.default, title: mod.title };
    }),
  );
}

export default async function ChangelogPage() {
  const releases = await getReleases();
  const entries = await resolveEntries(releases);
  const schemaReleases = releases.map((release) => ({
    version: release.version,
    date: release.date?.toISOString().slice(0, 10) ?? null,
  }));

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <JsonLd data={changelogPageGraph(schemaReleases)} />
      <SiteHeader />
      <main className="flex-1">
        <section className="pb-24 pt-16 md:pt-20">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-14 px-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
                Changelog
              </h1>
              <p className="text-base text-muted-foreground">
                Every update to the Woven app — newest first.
              </p>
              <LastUpdated />
            </div>
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The changelog is unavailable right now. Please check back soon.
              </p>
            ) : (
              entries.map((entry) => (
                <ReleaseEntry key={entry.release.version} entry={entry} />
              ))
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function ReleaseEntry({ entry }: { entry: ResolvedEntry }) {
  const { release, Body, title } = entry;
  const date = formatDate(release.date);

  return (
    <article className="flex flex-col gap-5 border-t border-border/60 pt-14 first:border-t-0 first:pt-0 md:flex-row md:gap-12">
      <div className="flex items-center gap-3 md:sticky md:top-24 md:w-36 md:shrink-0 md:flex-col md:items-start md:gap-2 md:self-start">
        <span className="rounded bg-card px-2 py-1 font-mono text-xs text-muted-foreground ring-1 ring-border">
          {release.version}
        </span>
        {date && (
          <time
            dateTime={release.date?.toISOString().slice(0, 10)}
            className="text-sm text-muted-foreground"
          >
            {date}
          </time>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {Body ? (
          <>
            {title && (
              <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            )}
            <div className="mt-1">
              <Body />
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold tracking-tight">
              v{release.version}
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {release.notes.map((note, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground md:text-base"
                >
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </article>
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
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/#faq" className="hover:text-foreground">
            FAQ
          </Link>
          <Link href="/changelog" className="text-foreground">
            Changelog
          </Link>
        </nav>
        <HeaderAuthControls />
      </div>
    </header>
  );
}
