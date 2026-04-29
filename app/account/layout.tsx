import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { AccountUserMenu } from "@/components/account/user-menu";
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
    <main className="min-h-screen bg-background">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
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
            <span className="font-heading text-lg font-medium">Woven</span>
          </Link>
          <AccountUserMenu email={user.email ?? ""} />
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-10">{children}</div>
    </main>
  );
}
