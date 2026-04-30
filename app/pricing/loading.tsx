export default function PricingLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="size-7 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="hidden gap-7 md:flex">
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-14 animate-pulse rounded bg-muted" />
            <div className="h-4 w-10 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden h-4 w-12 animate-pulse rounded bg-muted sm:block" />
            <div className="h-9 w-[6.5rem] animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <section>
          <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-16 pb-10 text-center md:pt-20">
            <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            <div className="mt-6 h-12 w-full max-w-2xl animate-pulse rounded bg-muted md:h-16" />
            <div className="mt-3 h-12 w-3/4 max-w-xl animate-pulse rounded bg-muted md:h-16" />
            <div className="mt-6 h-5 w-full max-w-xl animate-pulse rounded bg-muted" />
          </div>
        </section>
        <section className="pb-12">
          <div className="mx-auto w-full max-w-5xl px-6">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="h-96 animate-pulse rounded-3xl bg-card ring-1 ring-border" />
              <div className="h-96 animate-pulse rounded-3xl bg-card ring-1 ring-border" />
            </div>
          </div>
        </section>
        <section className="pb-16">
          <div className="mx-auto w-full max-w-5xl px-6">
            <div className="h-7 w-56 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
            <div className="mt-8 h-72 animate-pulse rounded-2xl bg-card ring-1 ring-border" />
          </div>
        </section>
      </main>
    </div>
  );
}
