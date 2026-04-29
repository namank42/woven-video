import { BalanceTopUpForm } from "@/components/account/balance-top-up-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { formatUsdFromMicros } from "@/lib/billing/money";
import { firstSearchParam } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LedgerEntry = {
  id: string;
  kind: string;
  amount_usd_micros: number | string;
  balance_after_usd_micros: number | string;
  source: string;
  source_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type UsageEvent = {
  job_id: string | null;
  model: string;
  operation: string;
  charged_amount_usd_micros: number | string;
};

type ActivityItem = {
  id: string;
  label: string;
  description: string;
  badge: string;
  amountUsdMicros: number;
  balanceAfterUsdMicros: number;
  createdAt: string;
};

type UsageSummary = {
  hostedUsageUsdMicros: number;
};

type AccountPageProps = {
  searchParams: Promise<{
    checkout?: string | string[];
    error?: string | string[];
  }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function asNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function titleCase(value: string) {
  return value
    .split(/[-_\s/]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function sourceLabel(source: string) {
  if (source === "stripe") {
    return "Stripe checkout";
  }

  if (source === "local") {
    return "Local test balance";
  }

  return titleCase(source);
}

function userFacingActivity({
  ledgerEntries,
}: {
  ledgerEntries: LedgerEntry[];
}) {
  const activity: ActivityItem[] = [];

  for (const entry of ledgerEntries) {
    if (entry.source === "job") {
      continue;
    }

    activity.push({
      id: entry.id,
      label:
        entry.kind === "promo"
          ? "Promotional balance"
          : entry.kind === "purchase"
            ? "Balance top-up"
            : titleCase(entry.kind),
      description: sourceLabel(entry.source),
      badge: entry.kind,
      amountUsdMicros: asNumber(entry.amount_usd_micros),
      balanceAfterUsdMicros: asNumber(entry.balance_after_usd_micros),
      createdAt: entry.created_at,
    });
  }

  return activity.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function summarizeUsage(events: UsageEvent[]): UsageSummary {
  return {
    hostedUsageUsdMicros: events.reduce(
      (sum, event) => sum + asNumber(event.charged_amount_usd_micros),
      0,
    ),
  };
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const params = await searchParams;
  const checkout = firstSearchParam(params.checkout);
  const error = firstSearchParam(params.error);
  const supabase = await createSupabaseServerClient();

  const { data: balanceRows, error: balanceError } =
    await supabase.rpc("get_billing_balance");
  const balanceUsdMicros = Array.isArray(balanceRows)
    ? Number(balanceRows[0]?.balance_usd_micros ?? 0)
    : 0;

  const { data: transactions } = await supabase
    .from("ledger_entries")
    .select(
      "id, kind, amount_usd_micros, balance_after_usd_micros, source, source_id, metadata, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(40);
  const { data: usageEvents } = await supabase
    .from("usage_events")
    .select("job_id, model, operation, charged_amount_usd_micros");
  const usageSummary = summarizeUsage((usageEvents ?? []) as UsageEvent[]);
  const activityItems = userFacingActivity({
    ledgerEntries: (transactions ?? []) as LedgerEntry[],
  }).slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-medium">Account</h1>
        <p className="max-w-2xl text-muted-foreground">
          Bring your own keys, or add prepaid balance when you want hosted
          models and media generation to just work.
        </p>
      </div>

      {checkout === "success" ? (
        <Field>
          <FieldDescription>
            Checkout completed. Stripe may take a moment to deliver the webhook.
          </FieldDescription>
        </Field>
      ) : null}

      {checkout === "cancelled" ? (
        <Field>
          <FieldDescription>Checkout cancelled.</FieldDescription>
        </Field>
      ) : null}

      {error ? (
        <Field data-invalid>
          <FieldError>{error}</FieldError>
        </Field>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Balance</CardTitle>
          <CardDescription>Available prepaid balance</CardDescription>
          <CardAction>
            <Badge variant="secondary">Prepaid</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="font-heading text-4xl font-medium tabular-nums">
            {formatUsdFromMicros(balanceUsdMicros)}
          </div>
          {balanceError ? (
            <p className="mt-3 text-sm text-destructive">
              Unable to load balance: {balanceError.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section>
        <BalanceTopUpForm />
      </section>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Total usage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-heading text-2xl font-medium tabular-nums">
            {formatUsdFromMicros(usageSummary.hostedUsageUsdMicros, {
              preciseSmallAmounts: true,
            })}
          </p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium">Balance activity</h2>
        <Card>
          <CardContent className="flex flex-col gap-0">
            {activityItems.length ? (
              activityItems.map((item, index) => (
                <div key={item.id}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex items-center justify-between gap-4 py-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{item.badge}</Badge>
                        <span className="truncate text-sm font-medium">
                          {item.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="truncate text-sm text-muted-foreground">
                          {item.description}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium tabular-nums">
                        {item.amountUsdMicros > 0 ? "+" : ""}
                        {formatUsdFromMicros(
                          item.amountUsdMicros,
                          {
                            preciseSmallAmounts: true,
                          },
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {formatUsdFromMicros(
                          item.balanceAfterUsdMicros,
                        )} after
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                No top-ups or balance adjustments yet.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
