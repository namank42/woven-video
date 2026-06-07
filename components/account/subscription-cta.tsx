import { CheckCircle2Icon, CheckIcon } from "lucide-react";

import {
  createPortalSession,
  createTrialCheckoutSession,
} from "@/app/account/actions";
import { ManageBillingButton } from "@/components/account/manage-billing-button";
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
} | null;

const trialBullets = [
  "Full Woven app, free for 7 days",
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
    const { status, trial_end, current_period_end, cancel_at_period_end } =
      subscription;

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
        ? cancel_at_period_end
          ? `Your trial ends ${trialDay ?? "soon"} and won't renew.`
          : `Free until ${trialDay ?? "soon"}, then $99/year. Cancel anytime before then.`
        : status === "past_due"
          ? "We couldn't charge your card. Update your payment method to keep access."
          : cancel_at_period_end
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
          <form action={createPortalSession}>
            <ManageBillingButton />
          </form>
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
          <div className="flex flex-col gap-1">
            <CardTitle>Start your free trial</CardTitle>
            <CardDescription>7 days free, then $99/year</CardDescription>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
            Required
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          Card required, $0 today. We email you 3 days before your trial ends.
          Cancel anytime before then and you won&apos;t be charged.
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
        <form action={createTrialCheckoutSession}>
          <StartTrialButton />
        </form>
      </CardContent>
    </Card>
  );
}
