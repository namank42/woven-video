import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { listMediaModels } from "@/lib/media/model-registry";
import { MEDIA_OPERATIONS, type MediaKind, type MediaOperation } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MEDIA_KINDS = ["image", "video", "audio", "captions"] as const;

function parseKind(value: string | null): MediaKind | null | undefined {
  if (value === null) return undefined;
  return (MEDIA_KINDS as readonly string[]).includes(value) ? (value as MediaKind) : null;
}

function parseOperation(value: string | null): MediaOperation | null | undefined {
  if (value === null) return undefined;
  return (MEDIA_OPERATIONS as readonly string[]).includes(value)
    ? (value as MediaOperation)
    : null;
}

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const url = new URL(request.url);
    const kind = parseKind(url.searchParams.get("kind"));
    const operation = parseOperation(url.searchParams.get("operation"));

    if (kind === null || operation === null) {
      return apiError("Invalid media catalog filter.", 400, "invalid_media_input");
    }

    const models = await listMediaModels({ kind, operation });

    return Response.json(
      {
        models: models.map((model) => ({
          id: model.id,
          provider: model.provider,
          kind: model.kind,
          display_name: model.displayName,
          enabled: true,
          operation: model.operation,
          supports_uploaded_inputs: model.supportsUploadedInputs,
          supported_input_types: model.supportedInputTypes,
          output_types: model.outputTypes,
          input_asset_schema: {
            roles: model.inputAssetSchema.roles.map((role) => ({
              role: role.role,
              provider_field: role.providerField,
              media_kind: role.mediaKind,
              required: role.required,
              min: role.min,
              max: role.max,
              content_type_prefixes: role.contentTypePrefixes,
            })),
          },
          estimated_price: {
            estimate_kind:
              model.pricingFormula.type === "static"
                ? "static"
                : model.pricingFormula.type === "gpt_image_conservative"
                  ? "conservative_quote"
                  : "parameter_quote",
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
