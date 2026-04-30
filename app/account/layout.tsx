import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { AccountUserMenu } from "@/components/account/user-menu";
import { SiteFooter } from "@/components/site-footer";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AccountLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2"
            aria-label="Woven home"
          >
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
          <AccountUserMenu email={user.email ?? ""} />
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {children}
      </div>
      <SiteFooter />
    </main>
  );
}
