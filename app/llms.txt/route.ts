import { llmsMarkdown } from "@/lib/agent-readiness/content";
import { markdownResponse } from "@/lib/agent-readiness/http";
export function GET(request: Request) { return markdownResponse(llmsMarkdown, request); }
export const HEAD = GET;
