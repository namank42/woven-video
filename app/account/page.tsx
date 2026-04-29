import {
  AlertCircleIcon,
  CheckCircle2Icon,
  InfoIcon,
  ReceiptIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { BalanceTopUpForm } from "@/components/account/balance-top-up-form";
import { Badge } from "@/components/ui/badge";
import { formatUsdFromMicros } from "@/lib/billing/money";
import { firstSearchParam } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

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

type AlertTone = "success" | "info" | "error";

function Alert({
  tone,
  children,
}: {
  tone: AlertTone;
  children: React.ReactNode;
}) {
  const Icon =
    tone === "success"
      ? CheckCircle2Icon
      : tone === "error"
        ? AlertCircleIcon
        : InfoIcon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        tone === "success" &&
          "border-foreground/10 bg-muted text-foreground",
        tone === "info" && "border-foreground/10 bg-muted text-foreground",
        tone === "error" &&
          "border-destructive/30 bg-destructive/5 text-destructive",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "success" && "text-foreground/70",
          tone === "info" && "text-foreground/70",
          tone === "error" && "text-destructive",
        )}
      />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent = false,
  errorMessage,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: boolean;
  errorMessage?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10",
        accent && "ring-foreground/15",
      )}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-md bg-muted",
            accent && "bg-foreground text-background",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "font-heading font-medium tabular-nums",
          accent ? "text-4xl" : "text-3xl",
        )}
      >
        {value}
      </div>
      {errorMessage ? (
        <p className="text-sm text-destructive">{errorMessage}</p>
      ) : null}
    </div>
  );
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
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-medium tracking-tight">
          Account
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your prepaid balance and review activity.
        </p>
      </div>

      {checkout === "success" ? (
        <Alert tone="success">
          Checkout completed. Stripe may take a moment to deliver the webhook.
        </Alert>
      ) : null}

      {checkout === "cancelled" ? (
        <Alert tone="info">Checkout cancelled.</Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      <section className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat
            icon={WalletIcon}
            label="Balance"
            value={formatUsdFromMicros(balanceUsdMicros)}
            accent
            errorMessage={
              balanceError
                ? `Unable to load balance: ${balanceError.message}`
                : undefined
            }
          />
          <Stat
            icon={TrendingUpIcon}
            label="Total usage"
            value={formatUsdFromMicros(usageSummary.hostedUsageUsdMicros, {
              preciseSmallAmounts: true,
            })}
          />
        </div>
      </section>

      <section>
        <BalanceTopUpForm />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-heading text-lg font-medium">Activity</h2>
            <p className="text-sm text-muted-foreground">
              Recent top-ups and balance adjustments.
            </p>
          </div>
        </div>

        {activityItems.length ? (
          <ul className="divide-y divide-foreground/10 rounded-xl bg-card ring-1 ring-foreground/10">
            {activityItems.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-4 px-4 py-3.5"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-normal">
                      {item.badge}
                    </Badge>
                    <span className="truncate text-sm font-medium">
                      {item.label}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.description} · {formatDate(item.createdAt)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <p
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      item.amountUsdMicros < 0 && "text-muted-foreground",
                    )}
                  >
                    {item.amountUsdMicros > 0 ? "+" : ""}
                    {formatUsdFromMicros(item.amountUsdMicros, {
                      preciseSmallAmounts: true,
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatUsdFromMicros(item.balanceAfterUsdMicros)} balance
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/15 bg-card/50 px-4 py-10 text-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted">
              <ReceiptIcon className="size-4 text-muted-foreground" />
            </span>
            <p className="text-sm font-medium">No activity yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Add prepaid balance above and your top-ups will show up here.
            </p>
          </div>
        )}
      </section>

    </div>
  );
}
