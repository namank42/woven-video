import { requireApiAuth } from "@/lib/api/auth";
import { apiError } from "@/lib/api/responses";
import {
  gatewayAuthorizationHeader,
  gatewayChatCompletionsUrl,
  lookupGatewayGeneration,
} from "@/lib/ai/vercel-gateway";
import {
  getHostedChatModel,
  normalizeHostedModelId,
  type ModelPricingRule,
} from "@/lib/billing/model-pricing";
import { chargeWithMarkupUsdMicros } from "@/lib/billing/money";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatBody = Record<string, unknown> & {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  stream_options?: Record<string, unknown>;
};

type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number | string;
  market_cost?: number | string;
  total_cost?: number | string;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

type ChatJob = {
  id: string;
};

type ChatSettlementFallback = {
  usage?: ChatUsage;
  gatewayGenerationId?: string;
  providerName?: string;
  rawProviderCost?: number | string;
};

function jsonBody(value: unknown): value is ChatBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asUsage(value: unknown): ChatUsage | undefined {
  return typeof value === "object" && value !== null ? (value as ChatUsage) : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function decimalValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return value;
    }
  }

  return undefined;
}

function firstDecimalValue(...values: unknown[]) {
  for (const value of values) {
    const parsed = decimalValue(value);

    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function gatewayMetadata(payload: unknown) {
  if (!jsonBody(payload)) {
    return undefined;
  }

  const providerMetadata = payload.providerMetadata ?? payload.provider_metadata;

  if (!jsonBody(providerMetadata)) {
    return undefined;
  }

  const gateway = providerMetadata.gateway ?? providerMetadata.vercel;

  return jsonBody(gateway) ? gateway : undefined;
}

function extractGenerationId(payload: unknown): string | undefined {
  if (!jsonBody(payload)) {
    return undefined;
  }

  const topLevelGenerationId = payload.generationId ?? payload.generation_id;

  if (typeof topLevelGenerationId === "string") {
    return topLevelGenerationId;
  }

  const providerMetadata = payload.providerMetadata ?? payload.provider_metadata;

  if (jsonBody(providerMetadata)) {
    const vercel = providerMetadata.vercel ?? providerMetadata.gateway;

    if (jsonBody(vercel)) {
      const generationId = vercel.generationId ?? vercel.generation_id ?? vercel.id;

      if (typeof generationId === "string") {
        return generationId;
      }
    }
  }

  if (typeof payload.id === "string") {
    return payload.id;
  }

  return undefined;
}

function extractProviderName(payload: unknown): string | undefined {
  if (!jsonBody(payload)) {
    return undefined;
  }

  const gateway = gatewayMetadata(payload);
  const topLevelRouting = jsonBody(payload.routing) ? payload.routing : undefined;
  const gatewayRouting = jsonBody(gateway?.routing) ? gateway?.routing : undefined;

  const providerName =
    payload.provider_name ??
    payload.providerName ??
    gateway?.provider_name ??
    gateway?.providerName ??
    gateway?.provider ??
    gatewayRouting?.finalProvider ??
    gatewayRouting?.final_provider ??
    gatewayRouting?.resolvedProvider ??
    gatewayRouting?.resolved_provider ??
    topLevelRouting?.finalProvider ??
    topLevelRouting?.final_provider;

  if (typeof providerName === "string" && providerName.trim()) {
    return providerName;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }

  for (const choice of choices) {
    if (!jsonBody(choice)) continue;
    const fromMessage = extractProviderName(choice.message);
    if (fromMessage) return fromMessage;
    const fromDelta = extractProviderName(choice.delta);
    if (fromDelta) return fromDelta;
  }

  return undefined;
}

function extractRawProviderCost(payload: unknown): number | string | undefined {
  if (!jsonBody(payload)) {
    return undefined;
  }

  const usage = jsonBody(payload.usage) ? payload.usage : undefined;
  const gateway = gatewayMetadata(payload);
  const payloadCost = firstDecimalValue(
    payload.total_cost,
    payload.totalCost,
    payload.cost,
    usage?.total_cost,
    usage?.totalCost,
    usage?.cost,
    usage?.market_cost,
    usage?.marketCost,
    gateway?.total_cost,
    gateway?.totalCost,
    gateway?.cost,
    gateway?.market_cost,
    gateway?.marketCost,
    gateway?.usage,
  );

  if (payloadCost !== undefined) {
    return payloadCost;
  }

  const choices = payload.choices;

  if (!Array.isArray(choices)) {
    return undefined;
  }

  for (const choice of choices) {
    if (!jsonBody(choice)) {
      continue;
    }

    const messageCost = extractRawProviderCost(choice.message);
    const deltaCost = extractRawProviderCost(choice.delta);

    if (messageCost !== undefined) {
      return messageCost;
    }

    if (deltaCost !== undefined) {
      return deltaCost;
    }
  }

  return undefined;
}

function createSettlementFallback(payload: unknown): ChatSettlementFallback {
  if (!jsonBody(payload)) {
    return {};
  }

  return {
    usage: asUsage(payload.usage),
    gatewayGenerationId: extractGenerationId(payload),
    providerName: extractProviderName(payload),
    rawProviderCost: extractRawProviderCost(payload),
  };
}

function createGatewayBody(body: ChatBody, model: string) {
  const gatewayBody: ChatBody = {
    ...body,
    model,
  };

  if (body.stream === true) {
    gatewayBody.stream_options = {
      ...(body.stream_options ?? {}),
      include_usage: true,
    };
  }

  const existingProviderOptions = jsonBody(body.providerOptions)
    ? body.providerOptions
    : {};
  const existingGateway = jsonBody(existingProviderOptions.gateway)
    ? existingProviderOptions.gateway
    : {};

  if (existingGateway.sort === undefined && existingGateway.order === undefined) {
    gatewayBody.providerOptions = {
      ...existingProviderOptions,
      gateway: {
        ...existingGateway,
        sort: "ttft",
      },
    };
  }

  return gatewayBody;
}

function createSafeJobInput(body: ChatBody, model: string) {
  return {
    model,
    stream: body.stream === true,
    message_count: Array.isArray(body.messages) ? body.messages.length : null,
    has_tools: Array.isArray(body.tools),
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? null,
  };
}

function summarizeRequest(body: ChatBody) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastMessageObj = jsonBody(lastMessage) ? lastMessage : null;
  const lastContent = lastMessageObj?.content;
  let lastMessageChars: number | null = null;
  const contentTypes = new Set<string>();

  if (typeof lastContent === "string") {
    lastMessageChars = lastContent.length;
    contentTypes.add("text");
  } else if (Array.isArray(lastContent)) {
    let total = 0;
    for (const part of lastContent) {
      if (jsonBody(part) && typeof part.type === "string") {
        contentTypes.add(part.type);
        if (typeof part.text === "string") {
          total += part.text.length;
        }
      }
    }
    lastMessageChars = total;
  }

  const toolNames = tools
    .map((tool) => {
      if (!jsonBody(tool)) return null;
      const fn = jsonBody(tool.function) ? tool.function : null;
      return typeof fn?.name === "string" ? fn.name : null;
    })
    .filter((name): name is string => name !== null);

  let toolChoiceShape: string | null = null;
  if (typeof body.tool_choice === "string") {
    toolChoiceShape = `string:${body.tool_choice}`;
  } else if (jsonBody(body.tool_choice)) {
    toolChoiceShape = "object";
  }

  return {
    messageCount: messages.length,
    lastMessageRole: jsonBody(lastMessageObj) ? lastMessageObj.role : null,
    lastMessageChars,
    hasSystemMessage: messages.some(
      (m) => jsonBody(m) && m.role === "system",
    ),
    toolCount: tools.length,
    toolNames,
    hasToolChoice: body.tool_choice !== undefined,
    toolChoiceShape,
    parallelToolCalls: body.parallel_tool_calls ?? null,
    hasResponseFormat: body.response_format !== undefined,
    reasoningEffort: body.reasoning_effort ?? null,
    maxTokens: body.max_tokens ?? body.max_completion_tokens ?? null,
    contentTypes: Array.from(contentTypes),
    stream: body.stream === true,
  };
}

function truncate(text: string, max = 2000) {
  return text.length > max ? `${text.slice(0, max)}…(${text.length - max} more chars)` : text;
}

function extractFinishReasonAndTools(payload: unknown): {
  finishReason: string | null;
  toolCallNames: string[];
} {
  if (!jsonBody(payload)) return { finishReason: null, toolCallNames: [] };
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const names: string[] = [];
  let finishReason: string | null = null;

  for (const choice of choices) {
    if (!jsonBody(choice)) continue;
    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
    const message = jsonBody(choice.message) ? choice.message : null;
    const delta = jsonBody(choice.delta) ? choice.delta : null;
    for (const source of [message, delta]) {
      const toolCalls = source && Array.isArray(source.tool_calls) ? source.tool_calls : [];
      for (const call of toolCalls) {
        if (!jsonBody(call)) continue;
        const fn = jsonBody(call.function) ? call.function : null;
        if (typeof fn?.name === "string" && fn.name) {
          names.push(fn.name);
        }
      }
    }
  }

  return { finishReason, toolCallNames: Array.from(new Set(names)) };
}

function responseHeaders(upstream: Response, jobId: string) {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  headers.set("cache-control", "no-store");
  headers.set("x-woven-job-id", jobId);

  return headers;
}

async function createChatJob({
  admin,
  userId,
  model,
  rule,
  input,
}: {
  admin: SupabaseAdmin;
  userId: string;
  model: string;
  rule: ModelPricingRule;
  input: Record<string, unknown>;
}) {
  const { data, error } = await admin
    .from("generation_jobs")
    .insert({
      user_id: userId,
      type: "chat",
      provider: rule.provider,
      model,
      status: "queued",
      estimated_cost_usd_micros: rule.reserve_amount_usd_micros,
      input,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ChatJob;
}

async function markJobFailed(admin: SupabaseAdmin, jobId: string, error: string) {
  await admin
    .from("generation_jobs")
    .update({
      status: "failed",
      error,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function reserveChatBalance({
  admin,
  userId,
  jobId,
  rule,
}: {
  admin: SupabaseAdmin;
  userId: string;
  jobId: string;
  rule: ModelPricingRule;
}) {
  const { error } = await admin.rpc("reserve_balance", {
    p_user_id: userId,
    p_job_id: jobId,
    p_amount_usd_micros: rule.reserve_amount_usd_micros,
    p_metadata: {
      model: rule.model,
      provider: rule.provider,
      operation: rule.operation,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  await admin
    .from("generation_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function releaseChatBalance({
  admin,
  jobId,
  error,
  status = "failed",
}: {
  admin: SupabaseAdmin;
  jobId: string;
  error: string;
  status?: "failed" | "cancelled";
}) {
  const { error: releaseError } = await admin.rpc("release_balance_reservation", {
    p_job_id: jobId,
    p_status: status,
    p_error: error,
    p_metadata: {
      reason: error,
    },
  });

  if (releaseError) {
    console.error("Failed to release chat reservation", releaseError);
  }
}

async function settleChatBalance({
  admin,
  userId,
  jobId,
  model,
  rule,
  generationId,
  fallback,
}: {
  admin: SupabaseAdmin;
  userId: string;
  jobId: string;
  model: string;
  rule: ModelPricingRule;
  generationId?: string;
  fallback?: ChatSettlementFallback;
}) {
  const fallbackUsage = fallback?.usage;
  const gatewayGeneration = generationId
    ? await lookupGatewayGeneration(generationId)
    : null;
  const gatewayGenerationId =
    gatewayGeneration?.id ?? generationId ?? fallback?.gatewayGenerationId ?? null;
  const providerName =
    gatewayGeneration?.provider_name ?? fallback?.providerName ?? null;
  const rawProviderCost =
    gatewayGeneration?.total_cost ??
    gatewayGeneration?.usage ??
    fallback?.rawProviderCost ??
    0;
  const rawProviderCostNumber = Number(rawProviderCost) || 0;
  const charge = chargeWithMarkupUsdMicros({
    rawCostUsd: rawProviderCost,
    markupBps: rule.markup_bps,
    minimumChargeUsdMicros: rule.minimum_charge_usd_micros,
  });
  const promptTokens =
    gatewayGeneration?.tokens_prompt ??
    gatewayGeneration?.native_tokens_prompt ??
    numberValue(fallbackUsage?.prompt_tokens);
  const completionTokens =
    gatewayGeneration?.tokens_completion ??
    gatewayGeneration?.native_tokens_completion ??
    numberValue(fallbackUsage?.completion_tokens);
  const reasoningTokens =
    gatewayGeneration?.native_tokens_reasoning ??
    numberValue(fallbackUsage?.completion_tokens_details?.reasoning_tokens);
  const cachedTokens =
    gatewayGeneration?.native_tokens_cached ??
    numberValue(fallbackUsage?.prompt_tokens_details?.cached_tokens);

  const { error: usageError } = await admin.from("usage_events").insert({
    user_id: userId,
    job_id: jobId,
    provider: rule.provider,
    model,
    operation: "chat",
    input_units: promptTokens,
    output_units: completionTokens,
    reasoning_units: reasoningTokens,
    cached_units: cachedTokens,
    gateway_generation_id: gatewayGenerationId,
    raw_provider_cost: rawProviderCostNumber,
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
    markup_amount_usd_micros: charge.markupAmountUsdMicros,
    metadata: {
      gateway_generation: gatewayGeneration,
      fallback,
      raw_cost_usd_micros: charge.rawCostUsdMicros,
    },
  });

  if (usageError) {
    throw new Error(usageError.message);
  }

  const output = {
    gateway_generation_id: gatewayGenerationId,
    provider_name: providerName,
    raw_provider_cost: rawProviderCostNumber,
    charged_amount_usd_micros: charge.chargedAmountUsdMicros,
  };

  const { error: settleError } = await admin.rpc("settle_balance_reservation", {
    p_job_id: jobId,
    p_final_cost_usd_micros: charge.chargedAmountUsdMicros,
    p_output: output,
    p_metadata: output,
  });

  if (settleError) {
    throw new Error(settleError.message);
  }
}

function createStreamObserver() {
  const decoder = new TextDecoder();
  let buffer = "";
  let generationId: string | undefined;
  let fallback: ChatSettlementFallback = {};
  let finishReason: string | null = null;
  const toolCallNames = new Set<string>();

  function observeJson(payload: unknown) {
    generationId = extractGenerationId(payload) ?? generationId;
    const nextFallback = createSettlementFallback(payload);
    const turn = extractFinishReasonAndTools(payload);
    if (turn.finishReason) finishReason = turn.finishReason;
    for (const name of turn.toolCallNames) toolCallNames.add(name);

    fallback = {
      usage: nextFallback.usage ?? fallback.usage,
      gatewayGenerationId:
        nextFallback.gatewayGenerationId ?? fallback.gatewayGenerationId,
      providerName: nextFallback.providerName ?? fallback.providerName,
      rawProviderCost: nextFallback.rawProviderCost ?? fallback.rawProviderCost,
    };
  }

  function observeText(text: string) {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const data = line.slice("data:".length).trim();

      if (!data || data === "[DONE]") {
        continue;
      }

      try {
        observeJson(JSON.parse(data));
      } catch {
        // Ignore malformed observer chunks. The byte stream is still proxied.
      }
    }
  }

  return {
    observe(chunk: Uint8Array) {
      observeText(decoder.decode(chunk, { stream: true }));
    },
    flush() {
      const tail = decoder.decode();

      if (tail) {
        observeText(tail);
      }
    },
    get generationId() {
      return generationId;
    },
    get fallback() {
      return {
        ...fallback,
        gatewayGenerationId: fallback.gatewayGenerationId ?? generationId,
      };
    },
    get finishReason() {
      return finishReason;
    },
    get toolCallNames() {
      return Array.from(toolCallNames);
    },
  };
}

async function proxyStreamingResponse({
  upstream,
  admin,
  userId,
  jobId,
  model,
  rule,
  abortController,
  startedAt,
}: {
  upstream: Response;
  admin: SupabaseAdmin;
  userId: string;
  jobId: string;
  model: string;
  rule: ModelPricingRule;
  abortController: AbortController;
  startedAt: number;
}) {
  const reader = upstream.body?.getReader();

  if (!reader) {
    await releaseChatBalance({
      admin,
      jobId,
      error: "Gateway returned an empty streaming response.",
    });

    return apiError("Gateway returned an empty response.", 502, "gateway_error");
  }

  const observer = createStreamObserver();
  let finalized = false;

  async function settleOnce() {
    if (finalized) {
      return;
    }

    finalized = true;
    observer.flush();
    console.log("[chat-completions] turn finished", {
      jobId,
      model,
      status: upstream.status,
      stream: true,
      finishReason: observer.finishReason,
      hadToolCalls: observer.toolCallNames.length > 0,
      toolCallNames: observer.toolCallNames,
      durationMs: Date.now() - startedAt,
      providerName: observer.fallback.providerName ?? null,
      generationId: observer.generationId ?? null,
    });
    await settleChatBalance({
      admin,
      userId,
      jobId,
      model,
      rule,
      generationId: observer.generationId,
      fallback: observer.fallback,
    });
  }

  async function releaseOnce(error: string, status: "failed" | "cancelled") {
    if (finalized) {
      return;
    }

    finalized = true;
    await releaseChatBalance({
      admin,
      jobId,
      error,
      status,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (value) {
            observer.observe(value);
            controller.enqueue(value);
          }
        }

        await settleOnce();
        controller.close();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Gateway stream failed.";
        await releaseOnce(message, "failed");
        controller.error(error);
      }
    },
    async cancel() {
      abortController.abort();
      await releaseOnce("Client cancelled the stream.", "cancelled");
    },
  });

  return new Response(stream, {
    status: upstream.status,
    headers: responseHeaders(upstream, jobId),
  });
}

async function proxyJsonResponse({
  upstream,
  admin,
  userId,
  jobId,
  model,
  rule,
  startedAt,
}: {
  upstream: Response;
  admin: SupabaseAdmin;
  userId: string;
  jobId: string;
  model: string;
  rule: ModelPricingRule;
  startedAt: number;
}) {
  const text = await upstream.text();
  const payload = JSON.parse(text) as Record<string, unknown>;
  const generationId = extractGenerationId(payload);
  const fallback = createSettlementFallback(payload);
  const turn = extractFinishReasonAndTools(payload);

  console.log("[chat-completions] turn finished", {
    jobId,
    model,
    status: upstream.status,
    stream: false,
    finishReason: turn.finishReason,
    hadToolCalls: turn.toolCallNames.length > 0,
    toolCallNames: turn.toolCallNames,
    durationMs: Date.now() - startedAt,
  });

  await settleChatBalance({
    admin,
    userId,
    jobId,
    model,
    rule,
    generationId,
    fallback,
  });

  return new Response(text, {
    status: upstream.status,
    headers: responseHeaders(upstream, jobId),
  });
}

export async function POST(request: Request) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const payload = await request.json().catch(() => null);

  if (!jsonBody(payload)) {
    return apiError("Request body must be a JSON object.");
  }

  const model = normalizeHostedModelId(payload.model);

  if (!model) {
    return apiError("Missing required field: model.");
  }

  const rule = await getHostedChatModel(model);

  if (!rule) {
    return apiError(`Hosted model is not enabled: ${model}`, 404, "model_not_found");
  }

  let gatewayUrl: string;
  let gatewayAuthorization: string;

  try {
    gatewayUrl = gatewayChatCompletionsUrl();
    gatewayAuthorization = gatewayAuthorizationHeader();
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "AI Gateway is not configured.",
      500,
      "gateway_not_configured",
    );
  }

  const admin = createSupabaseAdminClient();
  const userId = authResult.auth.user.id;
  const startedAt = Date.now();
  const requestSummary = summarizeRequest(payload);
  const job = await createChatJob({
    admin,
    userId,
    model,
    rule,
    input: createSafeJobInput(payload, model),
  });

  try {
    await reserveChatBalance({
      admin,
      userId,
      jobId: job.id,
      rule,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reserve balance.";
    await markJobFailed(admin, job.id, message);

    return apiError(
      message === "insufficient_balance"
        ? "Insufficient balance. Add funds before using Woven-hosted models."
        : message,
      message === "insufficient_balance" ? 402 : 500,
      message === "insufficient_balance"
        ? "insufficient_balance"
        : "balance_reservation_failed",
    );
  }

  const abortController = new AbortController();
  const gatewayBody = createGatewayBody(payload, model);
  const upstream = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      Authorization: gatewayAuthorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(gatewayBody),
    cache: "no-store",
    signal: abortController.signal,
  }).catch((error) => error as Error);

  if (upstream instanceof Error) {
    await releaseChatBalance({
      admin,
      jobId: job.id,
      error: upstream.message,
    });

    return apiError(upstream.message, 502, "gateway_error");
  }

  if (!upstream.ok) {
    const errorText = await upstream.text().catch(() => "");
    console.error("[chat-completions] gateway error", {
      jobId: job.id,
      model,
      gatewayStatus: upstream.status,
      gatewayBody: truncate(errorText || ""),
      requestSummary,
      durationMs: Date.now() - startedAt,
    });
    await releaseChatBalance({
      admin,
      jobId: job.id,
      error: errorText || `Gateway returned ${upstream.status}.`,
    });

    return new Response(errorText || "Gateway request failed.", {
      status: upstream.status,
      headers: responseHeaders(upstream, job.id),
    });
  }

  if (payload.stream === true) {
    return proxyStreamingResponse({
      upstream,
      admin,
      userId,
      jobId: job.id,
      model,
      rule,
      abortController,
      startedAt,
    });
  }

  try {
    return await proxyJsonResponse({
      upstream,
      admin,
      userId,
      jobId: job.id,
      model,
      rule,
      startedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to settle chat usage.";
    await releaseChatBalance({
      admin,
      jobId: job.id,
      error: message,
    });

    return apiError(message, 500, "usage_settlement_failed");
  }
}
