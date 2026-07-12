export const HOSTED_REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type HostedReasoningEffort = (typeof HOSTED_REASONING_EFFORTS)[number];

export type HostedReasoningCapabilities = {
  supports_reasoning: boolean;
  supported_reasoning_efforts: HostedReasoningEffort[];
  default_reasoning_effort: HostedReasoningEffort | null;
};

export type HostedReasoningParseResult =
  | { ok: true; value: HostedReasoningCapabilities }
  | { ok: false; value: HostedReasoningCapabilities; reason: string };

const effortOrder = new Map<HostedReasoningEffort, number>(
  HOSTED_REASONING_EFFORTS.map((effort, index) => [effort, index]),
);

function failure(reason: string): HostedReasoningParseResult {
  return {
    ok: false,
    value: {
      supports_reasoning: false,
      supported_reasoning_efforts: [],
      default_reasoning_effort: null,
    },
    reason,
  };
}

function isHostedReasoningEffort(value: unknown): value is HostedReasoningEffort {
  return typeof value === "string" && effortOrder.has(value as HostedReasoningEffort);
}

export function parseHostedReasoningCapabilities(
  metadata: Record<string, unknown>,
): HostedReasoningParseResult {
  const supportsReasoning = metadata.supports_reasoning;
  if (typeof supportsReasoning !== "boolean") {
    return failure("supports_reasoning must be a boolean");
  }

  const rawEfforts = metadata.supported_reasoning_efforts;
  if (!Array.isArray(rawEfforts)) {
    return failure("supported_reasoning_efforts must be an array");
  }

  const efforts: HostedReasoningEffort[] = [];
  const seen = new Set<HostedReasoningEffort>();
  let priorOrder = -1;

  for (const rawEffort of rawEfforts) {
    if (!isHostedReasoningEffort(rawEffort)) {
      return failure(
        `supported_reasoning_efforts contains unsupported value: ${String(rawEffort)}`,
      );
    }
    if (seen.has(rawEffort)) {
      return failure(`supported_reasoning_efforts contains duplicate value: ${rawEffort}`);
    }

    const order = effortOrder.get(rawEffort)!;
    if (order <= priorOrder) {
      return failure("supported_reasoning_efforts must use canonical order");
    }

    efforts.push(rawEffort);
    seen.add(rawEffort);
    priorOrder = order;
  }

  const defaultEffort = metadata.default_reasoning_effort;

  if (!supportsReasoning && (efforts.length > 0 || defaultEffort !== null)) {
    return failure("supports_reasoning false requires empty efforts and a null default");
  }

  if (efforts.length === 0 && defaultEffort !== null) {
    return failure("empty supported_reasoning_efforts requires a null default_reasoning_effort");
  }

  if (
    efforts.length > 0 &&
    (!isHostedReasoningEffort(defaultEffort) || !seen.has(defaultEffort))
  ) {
    return failure(
      "non-empty supported_reasoning_efforts requires a member default_reasoning_effort",
    );
  }

  return {
    ok: true,
    value: {
      supports_reasoning: supportsReasoning,
      supported_reasoning_efforts: efforts,
      default_reasoning_effort: isHostedReasoningEffort(defaultEffort) ? defaultEffort : null,
    },
  };
}
