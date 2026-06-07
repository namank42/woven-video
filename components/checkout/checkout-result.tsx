import Link from "next/link";
import { CheckCircle2Icon, InfoIcon } from "lucide-react";

type CheckoutResultProps = {
  variant: "success" | "cancelled";
};

const COPY = {
  success: {
    Icon: CheckCircle2Icon,
    iconClass: "text-emerald-500",
    headline: "Your free trial is live.",
    body:
      "You have full access to Woven for the next 7 days, and $5 in hosted credits have been added to your balance. You won't be charged until your trial ends.",
    backToApp:
      "Head back to the Woven app — it'll unlock automatically. You can close this tab.",
  },
  cancelled: {
    Icon: InfoIcon,
    iconClass: "text-muted-foreground",
    headline: "Checkout cancelled.",
    body: "No charge was made. Your card was not billed.",
    backToApp: "Head back to the Woven app whenever you're ready to try again.",
  },
} as const;

export function CheckoutResult({ variant }: CheckoutResultProps) {
  const { Icon, iconClass, headline, body, backToApp } = COPY[variant];

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-sm">
        <Icon className={`mx-auto mb-6 size-12 ${iconClass}`} aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {headline}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
        <p className="mt-6 text-sm font-medium text-foreground">{backToApp}</p>
        <div className="mt-8 border-t pt-6">
          <Link
            href="/account"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Manage billing →
          </Link>
        </div>
      </div>
    </main>
  );
}
