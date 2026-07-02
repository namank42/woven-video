import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { listMediaModels } from "@/lib/media/model-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const models = await listMediaModels();

    return Response.json(
      {
        models: models.map((model) => ({
          id: model.id,
          provider: model.provider,
          kind: model.kind,
          display_name: model.displayName,
          enabled: true,
          supports_uploaded_inputs: model.supportsUploadedInputs,
          supported_input_types: model.supportedInputTypes,
          output_types: model.outputTypes,
          estimated_price: {
            unit: model.pricing.unit,
            minimum_usd_micros: model.pricing.minimumUsdMicros,
            reserve_usd_micros: model.pricing.reserveUsdMicros,
            markup_bps: model.pricing.markupBps,
          },
          default_parameters: model.defaultParameters,
          parameter_schema: model.parameterSchema,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to list media models", error);
    return apiError("Unable to list media models.", 500, "media_models_failed");
  }
}
