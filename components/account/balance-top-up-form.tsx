"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { WalletIcon } from "lucide-react";

import { createCheckoutSession } from "@/app/account/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const quickAmounts = [
  {
    value: "500",
    label: "$5",
  },
  {
    value: "1000",
    label: "$10",
  },
  {
    value: "2000",
    label: "$20",
  },
  {
    value: "5000",
    label: "$50",
  },
] as const;

type TopUpChoice = (typeof quickAmounts)[number]["value"] | "custom";

function formatUsd(cents: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function parseCustomAmountCents(value: string) {
  const amount = Number(value);

  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

function BuyButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      className="h-10 rounded-lg px-5 sm:min-w-44"
    >
      <WalletIcon data-icon="inline-start" />
      {pending ? "Opening Stripe..." : "Continue to payment"}
    </Button>
  );
}

export function BalanceTopUpForm() {
  const [choice, setChoice] = useState<TopUpChoice>("2000");
  const [customAmount, setCustomAmount] = useState("25");

  const selectedQuickAmount = quickAmounts.find(
    (amount) => amount.value === choice,
  );
  const customAmountCents = parseCustomAmountCents(customAmount);
  const selectedAmountCents = useMemo(
    () => (choice === "custom" ? customAmountCents : Number(choice)),
    [choice, customAmountCents],
  );
  const canSubmit =
    choice !== "custom" ||
    (customAmountCents >= 500 && customAmountCents <= 10000);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Woven balance</CardTitle>
        <CardDescription>
          Prepaid balance for hosted models and media generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <form action={createCheckoutSession} className="flex flex-col">
          <input type="hidden" name="topUpChoice" value={choice} />
          {selectedQuickAmount ? (
            <input
              type="hidden"
              name="amountCents"
              value={selectedQuickAmount.value}
            />
          ) : null}

          <div className="flex flex-col items-center px-4 pt-2 pb-6">
            <div className="py-4 text-center font-heading text-4xl font-medium tracking-tight tabular-nums">
              {formatUsd(selectedAmountCents)}
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              {quickAmounts.map((amount) => {
                const selected = choice === amount.value;

                return (
                  <button
                    key={amount.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setChoice(amount.value)}
                    className={cn(
                      "h-9 rounded-lg border px-4 text-sm font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {amount.label}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={choice === "custom"}
                onClick={() => setChoice("custom")}
                className={cn(
                  "h-9 rounded-lg border px-4 text-sm font-medium transition-colors",
                  choice === "custom"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                Custom
              </button>
            </div>

            {choice === "custom" ? (
              <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
                <label
                  htmlFor="customAmountUsd"
                  className="text-sm font-medium"
                >
                  Custom amount
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="customAmountUsd"
                    name="customAmountUsd"
                    type="number"
                    inputMode="decimal"
                    min="5"
                    max="100"
                    step="1"
                    required
                    value={customAmount}
                    onChange={(event) => setCustomAmount(event.target.value)}
                    className="h-10 pl-7 tabular-nums"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Enter an amount from $5 to $100.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Secure checkout by Stripe.
            </p>
            <BuyButton disabled={!canSubmit} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
