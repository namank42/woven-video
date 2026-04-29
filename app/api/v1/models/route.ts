import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import { listHostedChatModels } from "@/lib/billing/model-pricing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const models = await listHostedChatModels();

    return Response.json({
      object: "list",
      data: models.map((model) => ({
        id: model.model,
        object: "model",
        created: 0,
        owned_by: "woven",
        display_name: model.display_name,
      })),
    });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Unable to list models.",
      500,
      "internal_server_error",
    );
  }
}
