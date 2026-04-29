import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";

import { signOut } from "@/app/account/actions";
import { Button } from "@/components/ui/button";
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
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <Link href="/" className="flex items-center gap-2">
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
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </main>
  );
}
