import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { chargeFlatTool } from "@/lib/billing/charge-flat-tool";
import { getWebToolPricing } from "@/lib/billing/tool-pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchBody = { query?: unknown };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  const payload = await request.json().catch(() => null);
  if (!isObject(payload)) {
    return apiError("Request body must be a JSON object.");
  }
  const { query } = payload as SearchBody;
  if (typeof query !== "string" || !query.trim()) {
    return apiError("Missing or empty field: query.");
  }
  if (query.length > 400) {
    return apiError("Query is too long (max 400 characters).");
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    return apiError(
      "Web search is not configured on this Woven instance.",
      503,
      "exa_not_configured",
    );
  }

  const rule = await getWebToolPricing("search");
  if (!rule) {
    return apiError(
      "Web search pricing rule is not enabled.",
      503,
      "tool_not_enabled",
    );
  }

  const result = await chargeFlatTool({
    userId: authResult.auth.user.id,
    rule,
    jobType: "web_search",
    input: { query: query.slice(0, 200) },
    run: async () => {
      const upstream = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          numResults: 5,
          type: "auto",
          contents: {
            text: { maxCharacters: 1500 },
            highlights: { numSentences: 3, highlightsPerUrl: 2 },
          },
        }),
        cache: "no-store",
        signal: request.signal,
      });

      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => "");
        return {
          ok: false as const,
          error: `Exa search failed: ${upstream.status} ${upstream.statusText}${
            detail ? ` — ${detail.slice(0, 300)}` : ""
          }`,
          status: upstream.status >= 500 ? 502 : upstream.status,
        };
      }

      const data = (await upstream.json()) as Record<string, unknown>;
      const rawCostUsd = readCostDollars(data);
      return { ok: true as const, output: data, rawCostUsd };
    },
  });

  if (!result.ok) {
    return apiError(result.error, result.status, result.code);
  }

  return Response.json(result.output, {
    headers: {
      "x-woven-job-id": result.jobId,
      "cache-control": "no-store",
    },
  });
}

function readCostDollars(payload: Record<string, unknown>): number | undefined {
  const cost = payload.costDollars ?? payload.cost_dollars;
  if (typeof cost === "number" && Number.isFinite(cost)) return cost;
  if (isObject(cost)) {
    const total = (cost as Record<string, unknown>).total;
    if (typeof total === "number" && Number.isFinite(total)) return total;
  }
  return undefined;
}
