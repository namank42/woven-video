import { CheckCircle2Icon } from "lucide-react";

import { createLicenseCheckoutSession } from "@/app/account/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <Card>
      <CardHeader>
        <CardTitle>Get your Woven lifetime license</CardTitle>
        <CardDescription>
          $99 one-time — yours forever. Includes $5 in hosted credits to start.
          7-day money-back guarantee.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <form action={createLicenseCheckoutSession} className="border-t bg-muted/20 px-4 py-4">
          <Button type="submit" className="h-10 rounded-lg px-5">
            Buy lifetime license — $99
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
