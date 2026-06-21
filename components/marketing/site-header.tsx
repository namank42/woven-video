import Image from "next/image";
import Link from "next/link";

import { HeaderAuthControls } from "@/components/header-auth-controls";

type NavItem = {
  href: string;
  label: string;
  active?: boolean;
};

type MarketingSiteHeaderProps = {
  nav?: NavItem[];
};

const defaultNav: NavItem[] = [
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/changelog", label: "Changelog" },
];

export function MarketingSiteHeader({ nav = defaultNav }: MarketingSiteHeaderProps) {
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
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={item.active ? "text-foreground" : "hover:text-foreground"}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <HeaderAuthControls />
      </div>
    </header>
  );
}