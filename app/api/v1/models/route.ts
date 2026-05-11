import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import {
  applyMarkupToPriceUsd,
  getModelCapabilities,
} from "@/lib/ai/model-capabilities";
import { listHostedChatModels } from "@/lib/billing/model-pricing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const models = await listHostedChatModels();

    const enriched = await Promise.all(
      models.map(async (model) => {
        const caps = await getModelCapabilities(model.model);

        return {
          id: model.model,
          object: "model" as const,
          created: 0,
          owned_by: "woven",
          display_name: model.display_name,
          capabilities: caps
            ? {
                context_length: caps.context_length,
                input_modalities: caps.input_modalities,
                output_modalities: caps.output_modalities,
                supports_reasoning: caps.supports_reasoning,
                supports_tools: caps.supports_tools,
                supports_vision: caps.supports_vision,
                supports_files: caps.supports_files,
              }
            : null,
          pricing: caps
            ? {
                input_per_mtok_usd: applyMarkupToPriceUsd(
                  caps.pricing_input_per_mtok_usd,
                  model.markup_bps,
                ),
                output_per_mtok_usd: applyMarkupToPriceUsd(
                  caps.pricing_output_per_mtok_usd,
                  model.markup_bps,
                ),
                cached_input_per_mtok_usd: applyMarkupToPriceUsd(
                  caps.pricing_cached_input_per_mtok_usd,
                  model.markup_bps,
                ),
                markup_bps: model.markup_bps,
              }
            : null,
        };
      }),
    );

    return Response.json({
      object: "list",
      data: enriched,
    });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Unable to list models.",
      500,
      "internal_server_error",
    );
  }
}
