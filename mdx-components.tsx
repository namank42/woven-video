import type { MDXComponents } from "mdx/types";
import Link from "next/link";

// Styling for authored changelog MDX bodies (content/changelog/*.mdx).
// Maps markdown elements to the site's typography so an authored release reads
// like the rest of the marketing site. Images render as plain <img> because
// markdown image syntax carries no intrinsic dimensions (next/image needs them);
// changelog screenshots are not LCP-critical, so lazy-loaded <img> is fine.
const components: MDXComponents = {
  h2: ({ children }) => (
    <h3 className="mt-10 text-lg font-semibold tracking-tight text-foreground">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-8 text-base font-semibold tracking-tight text-foreground">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 flex flex-col gap-2.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 flex list-decimal flex-col gap-2.5 pl-5">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground md:text-base">
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/40" />
      <span>{children}</span>
    </li>
  ),
  a: ({ href = "", children }) => {
    const isInternal = href.startsWith("/") || href.startsWith("#");
    const className =
      "font-medium text-foreground underline underline-offset-4 decoration-foreground/30 transition-colors hover:decoration-foreground";
    if (isInternal) {
      return (
        <Link href={href} className={className}>
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children }) => (
    <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[0.85em] text-foreground ring-1 ring-border">
      {children}
    </code>
  ),
  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={props.alt ?? ""}
      loading="lazy"
      className="mt-5 w-full rounded-xl ring-1 ring-border"
    />
  ),
};

export function useMDXComponents(): MDXComponents {
  return components;
}
