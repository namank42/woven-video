import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import type { HubCard } from "@/lib/seo/hubs";

export function HubCards({ cards }: { cards: HubCard[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="group flex flex-col gap-2 rounded-2xl bg-card p-6 ring-1 ring-border transition-colors hover:ring-foreground/30"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{card.title}</h2>
            <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{card.description}</p>
        </Link>
      ))}
    </div>
  );
}