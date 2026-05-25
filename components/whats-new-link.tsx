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
      className="group mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <span>What&rsquo;s new in</span>
      <span className="font-medium text-foreground/80 transition-colors group-hover:text-foreground">
        v{latest.version}
      </span>
      <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
