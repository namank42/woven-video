export default function AccountLoading() {
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

      <section className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatSkeleton accent />
          <StatSkeleton />
        </div>
      </section>

      <section>
        <div className="h-44 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading text-lg font-medium">Activity</h2>
          <p className="text-sm text-muted-foreground">
            Recent top-ups and balance adjustments.
          </p>
        </div>
        <ActivitySkeleton />
      </section>
    </div>
  );
}

function StatSkeleton({ accent = false }: { accent?: boolean }) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ${
        accent ? "ring-foreground/15" : "ring-foreground/10"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="size-7 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div
        className={`animate-pulse rounded bg-muted ${
          accent ? "h-10 w-32" : "h-9 w-24"
        }`}
      />
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <ul className="divide-y divide-foreground/10 rounded-xl bg-card ring-1 ring-foreground/10">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex items-center justify-between gap-4 px-4 py-3.5"
        >
          <div className="flex flex-col gap-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-44 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
