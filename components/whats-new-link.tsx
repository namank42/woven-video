import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { getReleases } from "@/lib/changelog";

// Async server component. Reuses the same data source as /changelog so the
// teaser is always in sync. Renders nothing if there are no releases.
export async function WhatsNewLink() {
  const releases = await getReleases();
  const latest = releases[0];
  if (!latest) return null;

  return (
    <Link
      href="/changelog"
      className="group mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="size-1.5 rounded-full bg-foreground" />
      See what&rsquo;s new in v{latest.version}
      <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
