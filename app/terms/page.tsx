import type { Metadata } from "next";
import Link from "next/link";

import { MarketingSiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CONTACT_EMAIL, SITE_CONTENT_UPDATED, SITE_LEGAL_NAME } from "@/lib/seo/constants";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `Terms for using Woven and woven.video, including trials, subscriptions, and hosted credits.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MarketingSiteHeader />
      <main className="flex-1">
        <article className="pb-24 pt-16 md:pt-20">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
                Terms of Service
              </h1>
              <p className="text-sm text-muted-foreground">
                Last updated {SITE_CONTENT_UPDATED}
              </p>
            </div>

            <div className="flex flex-col gap-6 text-base leading-relaxed text-muted-foreground">
              <p>
                These terms govern your use of Woven and woven.video, operated by{" "}
                {SITE_LEGAL_NAME}. By creating an account, starting a trial, or using
                our services, you agree to these terms.
              </p>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">The service</h2>
                <p>
                  Woven is a native macOS application for creating and editing
                  short-form video. woven.video provides account sign-in, downloads,
                  billing, and related web services. Features may change as we ship
                  updates — see our{" "}
                  <Link href="/changelog" className="text-foreground underline underline-offset-4">
                    changelog
                  </Link>
                  .
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Accounts & trials</h2>
                <p>
                  You need a Woven account to use the app. We offer a 7-day free trial,
                  then a paid subscription as described on our{" "}
                  <Link href="/pricing" className="text-foreground underline underline-offset-4">
                    pricing page
                  </Link>
                  . A valid payment method may be required to start a trial. Cancel
                  before the trial ends to avoid being charged.
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Billing</h2>
                <p>
                  Subscriptions and prepaid hosted credits are billed through Stripe.
                  Hosted model usage is deducted from your prepaid balance at published
                  rates. You are responsible for fees charged by third-party AI
                  providers when using your own API keys.
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Acceptable use</h2>
                <p>
                  Do not use Woven to create unlawful content, infringe others&apos;
                  rights, abuse our systems, or attempt to circumvent billing or access
                  controls.
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Disclaimer</h2>
                <p>
                  Woven and woven.video are provided &quot;as is&quot; without warranties.
                  AI-generated output may be inaccurate or incomplete — review before
                  publishing.
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Contact</h2>
                <p>
                  Questions about these terms? Email{" "}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="text-foreground underline underline-offset-4"
                  >
                    {CONTACT_EMAIL}
                  </a>
                  .
                </p>
              </section>
            </div>
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}