import { SITE_URL } from "@/lib/seo/constants";

export function GET(request: Request) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify({
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail: "This API route does not exist. See the Woven agent guide for available product and SFX resources.",
    instance: new URL(request.url).pathname,
    documentation: `${SITE_URL}/agents.md`,
  }), { status: 404, headers: { "Content-Type": "application/problem+json", "Cache-Control": "private, no-store" } });
}
export const HEAD = GET;
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
