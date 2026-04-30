"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { AppleIcon } from "lucide-react";

import { AccountUserMenu } from "@/components/account/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DOWNLOAD_URL = "https://release.woven.video/Woven.dmg";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function HeaderAuthControls() {
  const [user, setUser] = useState<User | null>(null);
  // If Supabase isn't configured we can render the signed-out state
  // immediately — there's no session to read.
  const [ready, setReady] = useState(!SUPABASE_CONFIGURED);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;

    const supabase = createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);

    // getSession() decodes the cookie locally — no network round-trip.
    // Used for non-security UI (rendering avatar vs sign-in). The actual
    // security boundary lives on app routes and RLS.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!ready) {
    return <div className="size-8 animate-pulse rounded-full bg-muted" />;
  }

  if (user) {
    return <AccountUserMenu email={user.email ?? ""} />;
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/login"
        className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
      >
        Sign in
      </Link>
      <a
        href={DOWNLOAD_URL}
        download
        className={cn(
          buttonVariants(),
          "h-9 rounded-full px-4 text-sm font-medium",
        )}
      >
        <AppleIcon className="size-4" />
        Download
      </a>
    </div>
  );
}
