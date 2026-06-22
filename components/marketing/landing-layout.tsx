import { MarketingSiteHeader } from "@/components/marketing/site-header";
import { JsonLd } from "@/components/seo/json-ld";
import { SiteFooter } from "@/components/site-footer";

type LandingLayoutProps = {
  schema: Record<string, unknown>;
  wide?: boolean;
  children: React.ReactNode;
};

export function LandingLayout({ schema, wide = false, children }: LandingLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <JsonLd data={schema} />
      <MarketingSiteHeader />
      <main className="flex-1">
        <article className="pb-24 pt-16 md:pt-20">
          <div
            className={`mx-auto flex w-full flex-col gap-10 px-6 ${wide ? "max-w-5xl" : "max-w-3xl"}`}
          >
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}