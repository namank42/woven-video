import type { Metadata } from "next";

import { ContactForm } from "@/components/contact/contact-form";
import { MarketingSiteHeader } from "@/components/marketing/site-header";
import { LastUpdated } from "@/components/marketing/page-sections";
import { JsonLd } from "@/components/seo/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { ANSWER_FIRST_CONTACT, CONTACT_EMAIL } from "@/lib/seo/constants";
import { contactPageGraph } from "@/lib/seo/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Woven Labs — questions, feedback, or help with your trial or billing for the Woven macOS app.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <JsonLd data={contactPageGraph()} />
      <MarketingSiteHeader />
      <main className="flex-1">
        <section className="pb-24 pt-16 md:pt-20">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
                Get in touch.
              </h1>
              <p className="text-base text-muted-foreground">{ANSWER_FIRST_CONTACT}</p>
              <p className="text-base text-muted-foreground">
                Send a note below or email{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
              <LastUpdated />
            </div>
            <ContactForm prefillEmail={user?.email ?? undefined} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}