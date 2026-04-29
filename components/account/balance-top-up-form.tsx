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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

const quickAmounts = [
  {
    value: "1000",
    label: "$10",
    description: "Small media tests and hosted model runs",
  },
  {
    value: "2000",
    label: "$20",
    description: "A practical starting balance",
  },
  {
    value: "5000",
    label: "$50",
    description: "More room for generated media",
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

function BuyButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="sm:min-w-32">
      <WalletIcon data-icon="inline-start" />
      {pending ? "Opening..." : label}
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
  const buttonLabel = useMemo(() => {
    if (choice === "custom") {
      return customAmountCents > 0
        ? `Add ${formatUsd(customAmountCents)}`
        : "Add balance";
    }

    return `Add ${formatUsd(Number(choice))}`;
  }, [choice, customAmountCents]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add balance</CardTitle>
        <CardDescription>
          Add prepaid balance for Woven-hosted models and media generation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createCheckoutSession} className="flex flex-col gap-4">
          <input type="hidden" name="topUpChoice" value={choice} />
          {selectedQuickAmount ? (
            <input
              type="hidden"
              name="amountCents"
              value={selectedQuickAmount.value}
            />
          ) : null}

          <RadioGroup
            value={choice}
            onValueChange={(value) => setChoice(value as TopUpChoice)}
            className="gap-1.5"
          >
            {quickAmounts.map((amount) => (
              <FieldLabel
                key={amount.value}
                htmlFor={`top-up-${amount.value}`}
                className={cn(
                  "rounded-lg border bg-background px-3 py-2.5 transition-colors",
                  "hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5",
                )}
                onClick={() => setChoice(amount.value)}
              >
                <Field orientation="horizontal" className="items-center gap-3">
                  <RadioGroupItem
                    id={`top-up-${amount.value}`}
                    value={amount.value}
                  />
                  <FieldContent className="grid gap-1 sm:grid-cols-[72px_1fr] sm:items-center">
                    <FieldTitle className="text-sm tabular-nums">
                      {amount.label}
                    </FieldTitle>
                    <FieldDescription>{amount.description}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}

            <FieldLabel
              htmlFor="top-up-custom"
              className={cn(
                "rounded-lg border bg-background px-3 py-2.5 transition-colors",
                "hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5",
              )}
              onClick={() => setChoice("custom")}
            >
              <Field orientation="horizontal" className="items-center gap-3">
                <RadioGroupItem id="top-up-custom" value="custom" />
                <FieldContent className="grid gap-2 sm:grid-cols-[72px_minmax(120px,180px)_1fr] sm:items-center">
                  <FieldTitle className="text-sm">Custom</FieldTitle>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
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
                      required={choice === "custom"}
                      value={customAmount}
                      onFocus={() => setChoice("custom")}
                      onChange={(event) => setCustomAmount(event.target.value)}
                      className={cn(
                        "h-7 pl-6 tabular-nums",
                        choice !== "custom" && "opacity-60",
                      )}
                    />
                  </div>
                  <FieldDescription className="sm:text-right">
                    {customAmountCents > 0
                      ? formatUsd(customAmountCents)
                      : "$5-$100"}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          </RadioGroup>

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Balance is prepaid and used only for hosted Woven usage.
            </p>
            <BuyButton label={buttonLabel} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
