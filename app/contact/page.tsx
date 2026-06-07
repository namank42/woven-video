import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ContactForm } from "@/components/contact/contact-form";
import { HeaderAuthControls } from "@/components/header-auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the Woven team — questions, feedback, or help with your trial or billing.",
  alternates: { canonical: "/contact" },
};

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
          <Link href="/changelog" className="hover:text-foreground">
            Changelog
          </Link>
        </nav>
        <HeaderAuthControls />
      </div>
    </header>
  );
}

export default async function ContactPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <section className="pb-24 pt-16 md:pt-20">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
                Get in touch.
              </h1>
              <p className="text-base text-muted-foreground">
                Questions, feedback, or help with your trial or billing — send a
                note and we&apos;ll get back to you. You can also email{" "}
                <a
                  href="mailto:hello@woven.video"
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  hello@woven.video
                </a>
                .
              </p>
            </div>
            <ContactForm prefillEmail={user?.email ?? undefined} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
