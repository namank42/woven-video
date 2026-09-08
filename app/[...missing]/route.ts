import { notFoundMarkdown } from "@/lib/agent-readiness/content";
import { markdownResponse } from "@/lib/agent-readiness/http";

// Static routes and configured /sfx rewrites take precedence over this fallback.
// An explicit response avoids a streamed notFound() accidentally returning 200.
export function GET(request: Request) {
  return markdownResponse(notFoundMarkdown, request, 404);
}
export const HEAD = GET;
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
