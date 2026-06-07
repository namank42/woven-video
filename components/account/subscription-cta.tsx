import { CheckCircle2Icon, CheckIcon } from "lucide-react";

import {
  createPortalSession,
  createTrialCheckoutSession,
  resumeSubscription,
} from "@/app/account/actions";
import { ManageBillingButton } from "@/components/account/manage-billing-button";
import { ResumeSubscriptionButton } from "@/components/account/resume-subscription-button";
import { StartTrialButton } from "@/components/account/start-trial-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type SubscriptionSummary = {
  status: string;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
} | null;

const trialBullets = [
  "$5 in Woven-hosted credits to try hosted models",
  "Bring your own Anthropic and OpenAI keys, or sign in with ChatGPT",
  "Cancel anytime before day 7 — no charge",
];

function formatDay(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function SubscriptionCta({
  hasAccess,
  subscription,
}: {
  hasAccess: boolean;
  subscription: SubscriptionSummary;
}) {
  // Active subscriber / trialing / past_due — show status + manage billing.
  if (hasAccess && subscription) {
    const { status, trial_end, current_period_end, cancel_at_period_end, cancel_at } =
      subscription;
    // Stripe schedules trial cancellations via cancel_at (a timestamp), NOT
    // cancel_at_period_end — so treat either signal as "won't renew".
    const willCancel = cancel_at_period_end || cancel_at != null;

    const title =
      status === "trialing"
        ? "Free trial active"
        : status === "past_due"
          ? "Payment needs attention"
          : "Subscription active";

    const trialDay = formatDay(trial_end);
    const renewDay = formatDay(current_period_end);
    const description =
      status === "trialing"
        ? willCancel
          ? `Your trial ends ${trialDay ?? "soon"} and won't renew.`
          : `Free until ${trialDay ?? "soon"}, then $99/year. Cancel anytime before then.`
        : status === "past_due"
          ? "We couldn't charge your card. Update your payment method to keep access."
          : willCancel
            ? `Active until ${renewDay ?? "the period end"} — set to cancel.`
            : `$99/year · renews ${renewDay ?? "annually"}.`;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 text-foreground/70" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {willCancel ? (
            <div className="flex flex-wrap items-center gap-2">
              <form action={resumeSubscription}>
                <ResumeSubscriptionButton />
              </form>
              <form action={createPortalSession}>
                <ManageBillingButton />
              </form>
            </div>
          ) : (
            <form action={createPortalSession}>
              <ManageBillingButton />
            </form>
          )}
        </CardContent>
      </Card>
    );
  }

  // Grandfathered free access (has access, no subscription row) — nothing to sell.
  if (hasAccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 text-foreground/70" />
            Full access
          </CardTitle>
          <CardDescription>
            You have full access to Woven. Hosted models draw from your prepaid
            balance below.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // No access — start the trial.
  return (
    <Card className="ring-2 ring-foreground">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>Start your free trial</CardTitle>
          <span className="inline-flex shrink-0 items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
            Required
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5 rounded-xl p-4 ring-1 ring-foreground/15">
            <span className="font-heading text-3xl font-medium tracking-tight tabular-nums">
              7 days
            </span>
            <span className="text-sm text-muted-foreground">free</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-xl bg-foreground p-4 text-background">
            <span className="font-heading text-3xl font-medium tracking-tight tabular-nums">
              $0
            </span>
            <span className="text-sm text-background/70">due today</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Then{" "}
          <span className="font-medium text-foreground">$99/year</span> · cancel
          anytime before day 7.
        </p>
        <ul className="flex flex-col gap-3 border-t pt-5 text-sm">
          {trialBullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                <CheckIcon className="size-3" />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <form action={createTrialCheckoutSession}>
            <StartTrialButton />
          </form>
          <p className="text-xs text-muted-foreground">
            Card required · we email you 3 days before your trial ends.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
