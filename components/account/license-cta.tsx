import { CheckCircle2Icon, CheckIcon } from "lucide-react";

import { createLicenseCheckoutSession } from "@/app/account/actions";
import { LicenseBuyButton } from "@/components/account/license-buy-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const licenseBullets = [
  "Lifetime access — no subscription",
  "Bring your own Anthropic and OpenAI keys",
  "Or sign in with ChatGPT — GPT-5+ on your Plus, Pro, or Team plan",
  "$5 in Woven-hosted credits included",
  "7-day money-back guarantee",
];

export function LicenseCta({ licensed }: { licensed: boolean }) {
  if (licensed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-5 text-foreground/70" />
            Lifetime license active
          </CardTitle>
          <CardDescription>
            You have full access to Woven, forever. Hosted models draw from your
            prepaid balance below.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="ring-2 ring-foreground">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Get your Woven lifetime license</CardTitle>
            <CardDescription>One-time — yours forever</CardDescription>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
            Required
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-4xl font-medium tracking-tight tabular-nums">
            $99
          </span>
          <span className="text-sm text-muted-foreground">once</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Includes $5 in hosted credits to start. 7-day money-back guarantee.
        </p>
        <ul className="flex flex-col gap-3 border-t pt-5 text-sm">
          {licenseBullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                <CheckIcon className="size-3" />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <form action={createLicenseCheckoutSession}>
          <LicenseBuyButton />
        </form>
      </CardContent>
    </Card>
  );
}
