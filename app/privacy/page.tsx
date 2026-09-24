import type { Metadata } from "next";
import Link from "next/link";

import { MarketingSiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CONTACT_EMAIL, PRIVACY_POLICY_UPDATED, SITE_LEGAL_NAME } from "@/lib/seo/constants";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SITE_LEGAL_NAME} collects, uses, and protects your data when you use Woven and woven.video.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MarketingSiteHeader />
      <main className="flex-1">
        <article className="pb-24 pt-16 md:pt-20">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6">
            <div className="flex flex-col gap-3">
              <h1 className="text-4xl font-semibold tracking-[-0.025em] leading-[1.05] md:text-5xl">
                Privacy Policy
              </h1>
              <p className="text-sm text-muted-foreground">
                Last updated {PRIVACY_POLICY_UPDATED}
              </p>
            </div>

            <div className="flex flex-col gap-6 text-base leading-relaxed text-muted-foreground">
              <p>
                {SITE_LEGAL_NAME} (&quot;we&quot;, &quot;us&quot;) operates Woven and
                woven.video. This policy describes how we handle information when you
                use our website, account, billing services, and the Woven desktop app.
              </p>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">What we collect</h2>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Account information (e.g. email) when you sign in with Google.</li>
                  <li>Billing and subscription data processed via Stripe.</li>
                  <li>Usage data for hosted AI models and paid features (e.g. caption jobs).</li>
                  <li>Messages you send through our contact form or email.</li>
                  <li>Basic analytics on woven.video (e.g. page views via Vercel Analytics).</li>
                  <li>
                    Pseudonymous, content-free product and diagnostic telemetry collected
                    automatically by supported Woven desktop app versions. Before you sign
                    in, this uses a persistent installation identifier; after you sign in,
                    it may be associated with your account to help us understand product
                    reliability and use.
                  </li>
                </ul>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">What stays local</h2>
                <p>
                  Woven is a native Mac app. Your video projects and media files stay on
                  your Mac. We do not include project or media contents in desktop
                  telemetry. Content leaves your Mac only when you use a cloud feature
                  (such as hosted model requests or caption processing uploads) or,
                  unless you turn it off, when the app sends an automatic error report
                  (see below).
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Desktop telemetry</h2>
                <p>
                  This automatic telemetry helps us measure product features, reliability,
                  performance, and delivery health. It uses fixed categories, coarse counts
                  and durations, app and device-version information, and pseudonymous
                  identifiers. It does not include message or prompt text, assistant
                  responses, reasoning, caption text, media contents, filenames, filesystem
                  paths, URLs, raw tool inputs or outputs, provider response bodies,
                  passwords, or authorization tokens.
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">
                  Automatic error reports
                </h2>
                <p>
                  When something fails in the Woven desktop app, such as an export or an
                  AI request, the app automatically sends us an error report so we can
                  find and fix the problem.
                </p>
                <p>An error report includes:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    the error messages and codes produced by the app, its components and
                    the services it uses;
                  </li>
                  <li>which part of the app failed;</li>
                  <li>the app and model versions involved;</li>
                  <li>the pseudonymous identifiers described above.</li>
                </ul>
                <p>Before a report leaves your Mac, the app:</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>removes passwords, access tokens, API keys and similar secrets;</li>
                  <li>replaces your home folder and project folder with placeholders.</li>
                </ul>
                <p>
                  Error messages can occasionally include short fragments of the content
                  involved in the failure, such as part of a model&apos;s reply or a file
                  name.
                </p>
                <p>
                  We use error reports only to diagnose and fix problems. We never use
                  them to train AI models, and we delete them after 90 days.
                </p>
                <p>
                  You can turn automatic error reports off at any time in Settings ›
                  Privacy. To have your reports deleted, email us.
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">How we use data</h2>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Provide sign-in, licensing, and billing.</li>
                  <li>Run Woven-hosted AI and caption processing you request.</li>
                  <li>Respond to support requests.</li>
                  <li>Improve the product and website.</li>
                  <li>Measure desktop feature use, reliability, performance, and service delivery.</li>
                  <li>Diagnose and fix errors reported automatically by the desktop app.</li>
                </ul>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Third parties</h2>
                <p>
                  We use service providers such as Supabase (auth/database), Stripe
                  (payments), and AI providers when you use Woven-hosted models or
                  related features. Their policies govern how they process data on our
                  behalf.
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-foreground">Contact</h2>
                <p>
                  Questions about privacy? Email{" "}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="text-foreground underline underline-offset-4"
                  >
                    {CONTACT_EMAIL}
                  </a>{" "}
                  or use our{" "}
                  <Link href="/contact" className="text-foreground underline underline-offset-4">
                    contact page
                  </Link>
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
