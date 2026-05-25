import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { getReleases, type Release } from "@/lib/changelog";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Every update to the Woven app — new features, improvements, and fixes, newest first.",
  alternates: { canonical: "/changelog" },
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

export default async function ChangelogPage() {
  const releases = await getReleases();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <section>
          <div className="mx-auto w-full max-w-3xl px-6 pt-16 pb-10 md:pt-20">
            <SectionLabel>Changelog</SectionLabel>
            <h1 className="mt-6 text-4xl font-semibold tracking-[-0.03em] leading-[1.05] md:text-5xl">
              What&rsquo;s new in Woven
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Every update to the app, newest first.
            </p>
          </div>
        </section>

        <section className="pb-24">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-6">
            {releases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The changelog is unavailable right now. Please check back soon.
              </p>
            ) : (
              releases.map((release) => (
                <ReleaseEntry key={release.version} release={release} />
              ))
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function ReleaseEntry({ release }: { release: Release }) {
  const date = formatDate(release.date);
  return (
    <article className="flex flex-col gap-5 border-t border-border/60 pt-12 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          v{release.version}
        </h2>
        {date && (
          <time
            dateTime={release.date?.toISOString().slice(0, 10)}
            className="text-sm text-muted-foreground"
          >
            {date}
          </time>
        )}
      </div>

      {release.lead && (
        <p className="text-base leading-relaxed text-muted-foreground">
          {release.lead}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {release.notes.map((note, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-sm leading-relaxed md:text-base"
          >
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
            <span>{note}</span>
          </li>
        ))}
      </ul>

      {release.media && release.media.length > 0 && (
        <div className="mt-2 flex flex-col gap-6">
          {release.media.map((item) =>
            item.type === "image" ? (
              <figure key={item.src} className="flex flex-col gap-2">
                <Image
                  src={item.src}
                  alt={item.alt}
                  width={item.width}
                  height={item.height}
                  className="w-full rounded-xl ring-1 ring-border"
                />
                {item.caption && (
                  <figcaption className="text-xs text-muted-foreground">
                    {item.caption}
                  </figcaption>
                )}
              </figure>
            ) : (
              <figure key={item.src} className="flex flex-col gap-2">
                <video
                  src={item.src}
                  poster={item.poster}
                  controls
                  className="w-full rounded-xl ring-1 ring-border"
                />
                {item.caption && (
                  <figcaption className="text-xs text-muted-foreground">
                    {item.caption}
                  </figcaption>
                )}
              </figure>
            ),
          )}
        </div>
      )}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-foreground" />
      {children}
    </div>
  );
}
