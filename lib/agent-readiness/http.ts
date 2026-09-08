import Negotiator from "negotiator";

export function preferredDocumentType(accept: string | null) {
  return new Negotiator({ headers: { accept: accept === null ? undefined : accept } })
    .mediaType(["text/html; charset=utf-8", "text/markdown; charset=utf-8"]);
}

export function markdownResponse(body: string, request?: Request, status = 200) {
  return new Response(request?.method === "HEAD" ? null : body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Vary": "Accept, Accept-Encoding",
      // Do not depend on a deployment's custom CDN cache key for variants.
      "Cache-Control": "private, no-store",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "Link": '</llms.txt>; rel="describedby"',
      ...(status === 404 ? { "X-Robots-Tag": "noindex" } : {}),
    },
  });
}
