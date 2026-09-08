import { productGuideMarkdown } from "@/lib/agent-readiness/product-guide";
import { markdownResponse } from "@/lib/agent-readiness/http";
export function GET(request: Request) { return markdownResponse(productGuideMarkdown, request); }
export const HEAD = GET;
