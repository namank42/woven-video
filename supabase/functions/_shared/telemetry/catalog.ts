export type TelemetryPropertyType =
  | "string"
  | "number"
  | "boolean"
  | "string_array"
  | "number_array";

export type TelemetryPropertyRule = {
  type: TelemetryPropertyType;
  enum?: readonly string[];
  integer?: boolean;
  min?: number;
  max?: number;
  hash?: boolean;
};

export type TelemetryCatalogEntry = {
  stream: "product" | "operational";
  stages: readonly string[];
  priority: 0 | 1 | 2 | 3;
  requiredProperties: Readonly<Record<string, TelemetryPropertyRule>>;
  optionalProperties: Readonly<Record<string, TelemetryPropertyRule>>;
};

const string = (values: readonly string[]): TelemetryPropertyRule => ({
  type: "string",
  enum: values,
});
const hash = (): TelemetryPropertyRule => ({ type: "string", hash: true });
const integer = (min = 0, max = 1_000_000_000): TelemetryPropertyRule => ({
  type: "number",
  integer: true,
  min,
  max,
});
const number = (min = 0, max = 1_000_000_000): TelemetryPropertyRule => ({
  type: "number",
  min,
  max,
});
const boolean = (): TelemetryPropertyRule => ({ type: "boolean" });
const strings = (values: readonly string[]): TelemetryPropertyRule => ({
  type: "string_array",
  enum: values,
});
const numbers = (): TelemetryPropertyRule => ({ type: "number_array" });

const reasonCode = string([
  "none",
  "unknown",
  "cancelled",
  "timed_out",
  "invalid_state",
  "invalid_input",
  "not_found",
  "not_supported",
  "not_authorized",
  "unavailable",
  "conflict",
  "rate_limited",
  "network",
  "provider",
  "storage",
  "validation",
  "transport",
  "authentication",
  "configuration",
  "quota_exceeded",
  "permission_denied",
  "interrupted",
  "dependency_failed",
  "write_failed",
  "read_failed",
  "preflight_failed",
  "rejected",
  "failed",
]);
const outcomeCode = string([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
  "rejected",
  "partial",
  "unknown",
]);
const releaseVersionFamily = string([
  "pre_1_0",
  "v1",
  "v2_or_later",
  "unknown",
]);
const component = string([
  "app",
  "auth",
  "billing",
  "workspace",
  "chat",
  "agent",
  "model",
  "tool_runtime",
  "mcp",
  "sidecar",
  "storage",
  "media",
  "caption",
  "reel_editor",
  "export",
  "telemetry",
  "network",
  "other",
  "unknown",
]);
const desktopAction = string([
  "new_workspace",
  "open_workspace",
  "new_chat",
  "open_settings",
  "new_reel",
  "open_feedback",
  "check_for_updates",
  "quit",
  "other",
  "unknown",
]);
const onboardingStep = string([
  "welcome",
  "sign_in",
  "create_workspace",
  "start_chat",
  "complete",
  "unknown",
]);
const settingId = string([
  "appearance",
  "notifications",
  "updates",
  "privacy",
  "telemetry",
  "model",
  "reasoning",
  "access_mode",
  "workspace",
  "editor",
  "captions",
  "export",
  "other",
  "unknown",
]);
const settingValue = string([
  "enabled",
  "disabled",
  "system",
  "automatic",
  "manual",
  "default",
  "compact",
  "comfortable",
  "light",
  "dark",
  "high",
  "medium",
  "low",
  "other",
  "unknown",
]);
const bucket = string([
  "zero",
  "one",
  "two_to_five",
  "six_to_ten",
  "eleven_to_twenty_five",
  "twenty_six_to_fifty",
  "fifty_one_to_one_hundred",
  "over_one_hundred",
  "tiny",
  "small",
  "medium",
  "large",
  "very_large",
  "unknown",
]);
const durationBucket = string([
  "under_1s",
  "1s_to_5s",
  "5s_to_15s",
  "15s_to_30s",
  "30s_to_60s",
  "1m_to_5m",
  "5m_to_15m",
  "15m_to_60m",
  "over_60m",
  "unknown",
]);
const inputModality = string([
  "text",
  "attachment",
  "mixed",
  "voice",
  "none",
  "unknown",
]);
const modelFamily = string([
  "openai",
  "anthropic",
  "google",
  "xai",
  "moonshot",
  "local",
  "other",
  "unknown",
]);
const providerFamily = string([
  "woven",
  "openai",
  "anthropic",
  "google",
  "xai",
  "moonshot",
  "local",
  "other",
  "unknown",
]);
const effortLevel = string([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "unknown",
]);
const phase = string([
  "admission",
  "authentication",
  "configuration",
  "connection",
  "decode",
  "download",
  "execution",
  "finalization",
  "generation",
  "initialization",
  "launch",
  "persistence",
  "persist",
  "preflight",
  "recovery",
  "render",
  "request",
  "response",
  "startup",
  "transport",
  "upload",
  "validation",
  "unknown",
]);
const mediaType = string([
  "image",
  "video",
  "audio",
  "caption",
  "document",
  "other",
  "unknown",
]);
const artifactType = string([
  "file",
  "diff",
  "image",
  "video",
  "audio",
  "document",
  "spreadsheet",
  "presentation",
  "pdf",
  "other",
  "unknown",
]);
const integrationFamily = string([
  "mcp",
  "github",
  "google_drive",
  "slack",
  "notion",
  "figma",
  "linear",
  "other",
  "unknown",
]);
const exportPreset = string([
  "default",
  "social",
  "source",
  "custom",
  "unknown",
]);
const quality = string([
  "draft",
  "standard",
  "high",
  "maximum",
  "unknown",
]);
const toolFamilyValues = [
  "shell",
  "filesystem",
  "search",
  "browser",
  "mcp",
  "media",
  "database",
  "git",
  "other",
  "unknown",
] as const;
const toolFamily = string(toolFamilyValues);

const invocationSource = string([
  "button",
  "keyboard_shortcut",
  "menu",
  "context_menu",
  "command_palette",
  "agent",
  "system",
]);
const standardStages = [
  "attempted",
  "admitted",
  "rejected",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;
const incidentProperties = {
  error_domain: string([
    "app.lifecycle",
    "sidecar.process",
    "sidecar.transport",
    "agent.validation",
    "agent.persistence",
    "model.configuration",
    "model.provider",
    "tool.execution",
    "mcp.authentication",
    "mcp.transport",
    "storage",
    "media_generation",
    "export",
    "telemetry.delivery",
  ]),
  error_code: reasonCode,
  component,
  phase,
  severity: string(["info", "warning", "error", "critical"]),
  user_visible: boolean(),
  retryable: boolean(),
  transient: boolean(),
  attempt_number: integer(0, 100),
  recovery_action: string([
    "none",
    "retry",
    "restart",
    "reconnect",
    "reset",
    "fallback",
    "user_action",
    "unknown",
  ]),
  recovery_outcome: string([
    "not_attempted",
    "succeeded",
    "failed",
    "partial",
    "unknown",
  ]),
  error_fingerprint: hash(),
  duration_ms: integer(),
};
const requiredIncidentProperties = {
  error_domain: incidentProperties.error_domain,
  error_code: incidentProperties.error_code,
  component: incidentProperties.component,
  phase: incidentProperties.phase,
  severity: incidentProperties.severity,
  user_visible: incidentProperties.user_visible,
  retryable: incidentProperties.retryable,
  transient: incidentProperties.transient,
  error_fingerprint: incidentProperties.error_fingerprint,
};
const optionalIncidentProperties = {
  attempt_number: incidentProperties.attempt_number,
  recovery_action: incidentProperties.recovery_action,
  recovery_outcome: incidentProperties.recovery_outcome,
  duration_ms: incidentProperties.duration_ms,
};
const modelProperties = {
  model_id: hash(),
  model_family: modelFamily,
  model_hash: hash(),
  provider_family: providerFamily,
  access_mode: string(["woven", "bring_your_own_key", "chatgpt_codex"]),
  effort_level: effortLevel,
};

function product(
  stages: readonly string[],
  priority: 0 | 1 | 2 | 3,
  optionalProperties: Readonly<Record<string, TelemetryPropertyRule>> = {},
  requiredProperties: Readonly<Record<string, TelemetryPropertyRule>> = {},
): TelemetryCatalogEntry {
  return {
    stream: "product",
    stages,
    priority,
    requiredProperties,
    optionalProperties,
  };
}

function operational(
  stages: readonly string[],
  priority: 0 | 1 | 2 | 3,
  optionalProperties: Readonly<Record<string, TelemetryPropertyRule>> = {},
  requiredProperties: Readonly<Record<string, TelemetryPropertyRule>> = {},
): TelemetryCatalogEntry {
  return {
    stream: "operational",
    stages,
    priority,
    requiredProperties,
    optionalProperties,
  };
}

export const TELEMETRY_CATALOG_V1: Readonly<
  Record<string, TelemetryCatalogEntry>
> = {
  app_lifecycle: product(
    [
      "launch_started",
      "launch_completed",
      "foregrounded",
      "backgrounded",
      "terminated",
      "abnormal_exit_recovered",
    ],
    2,
    {
      launch_reason: string([
        "user",
        "login_item",
        "reopen",
        "update",
        "system",
        "unknown",
      ]),
      prior_version: releaseVersionFamily,
      duration_ms: integer(),
    },
  ),
  app_update: product(
    ["available", "started", "installed", "failed", "dismissed"],
    2,
    {
      from_version: releaseVersionFamily,
      to_version: releaseVersionFamily,
      automatic: boolean(),
      reason_code: reasonCode,
    },
  ),
  surface_viewed: product(["viewed"], 3, {
    surface: string([
      "welcome",
      "workspace",
      "chat",
      "settings",
      "reel_editor",
      "paywall",
      "onboarding",
      "feedback",
      "unknown",
    ]),
    invocation_source: invocationSource,
  }),
  desktop_command: product(["invoked", "succeeded", "failed", "cancelled"], 2, {
    action: desktopAction,
    invocation_source: invocationSource,
    reason_code: reasonCode,
  }),
  sign_in: product(["attempted", "succeeded", "failed", "cancelled"], 2, {
    provider: string(["apple", "google", "email", "unknown"]),
    reason_code: reasonCode,
  }),
  sign_out: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    reason_code: reasonCode,
  }),
  entitlement_refresh: product(["attempted", "succeeded", "failed"], 2, {
    entitlement_state: string([
      "unknown",
      "free",
      "trial",
      "active",
      "past_due",
      "cancelled",
      "expired",
    ]),
    source_kind: string([
      "cache",
      "server",
      "purchase",
      "restore",
      "startup",
      "unknown",
    ]),
    reason_code: reasonCode,
  }),
  paywall_viewed: product(["viewed"], 3, {
    entry_point: string([
      "app_launch",
      "settings",
      "checkout",
      "feature_gate",
      "usage_limit",
      "unknown",
    ]),
    entitlement_state: string([
      "unknown",
      "free",
      "trial",
      "active",
      "past_due",
      "cancelled",
      "expired",
    ]),
  }),
  checkout: product(["attempted", "succeeded", "failed", "cancelled"], 2, {
    offer_id: hash(),
    plan_id: hash(),
    reason_code: reasonCode,
  }),
  trial_activation: product(
    ["offered", "attempted", "succeeded", "failed"],
    2,
    {
      offer_id: hash(),
      reason_code: reasonCode,
    },
  ),
  onboarding: product(["started", "completed", "skipped"], 2, {
    entry_reason: string(["first_launch", "manual", "reset", "unknown"]),
    duration_ms: integer(),
  }),
  onboarding_step: product(["viewed", "completed"], 3, {
    step_id: onboardingStep,
  }),
  workspace_create: product(standardStages, 2, {
    invocation_source: invocationSource,
    template_kind: string(["blank", "starter", "imported", "unknown"]),
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  workspace_open: product(standardStages, 2, {
    invocation_source: invocationSource,
    open_source: string(["recent", "manual", "import", "system"]),
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  workspace_import: product(standardStages, 2, {
    invocation_source: invocationSource,
    import_kind: string(["woven_workspace", "archive", "legacy", "unknown"]),
    size_bucket: bucket,
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  workspace_switch: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    reason_code: reasonCode,
  }),
  chat_create: product(standardStages, 2, {
    invocation_source: invocationSource,
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  chat_open: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    reason_code: reasonCode,
  }),
  chat_archive: product(["attempted", "succeeded", "failed"], 2, {
    action: string(["archive", "unarchive"]),
    invocation_source: invocationSource,
    reason_code: reasonCode,
  }),
  message_send: product(["attempted", "admitted", "rejected"], 2, {
    input_modality: inputModality,
    attachment_count_bucket: bucket,
    rejection_code: reasonCode,
  }),
  attachment_add: product(standardStages, 2, {
    attachment_type: mediaType,
    source_kind: string([
      "file_picker",
      "drag_drop",
      "paste",
      "share_extension",
      "agent",
      "unknown",
    ]),
    count_bucket: bucket,
    size_bucket: bucket,
    reason_code: reasonCode,
  }),
  agent_turn: product(
    ["started", "succeeded", "failed", "cancelled", "interrupted"],
    1,
    {
      ...modelProperties,
      duration_ms: integer(),
      duration_bucket: durationBucket,
      outcome_code: outcomeCode,
    },
  ),
  agent_retry: product(["attempted", "admitted", "rejected"], 2, {
    prior_attempt_number: integer(0, 100),
    trigger: string(["user", "automatic", "network", "provider", "unknown"]),
    rejection_code: reasonCode,
  }),
  agent_cancel: product(["requested", "acknowledged", "failed"], 1, {
    phase,
    reason_code: reasonCode,
  }),
  model_change: product(["committed"], 2, {
    previous_model_id: hash(),
    selected_model_id: hash(),
    previous_model_family: modelFamily,
    selected_model_family: modelFamily,
    previous_model_hash: hash(),
    selected_model_hash: hash(),
  }),
  access_mode_change: product(["committed"], 2, {
    previous_mode: string(["woven", "bring_your_own_key", "chatgpt_codex"]),
    selected_mode: string(["woven", "bring_your_own_key", "chatgpt_codex"]),
  }),
  reasoning_change: product(["committed"], 2, {
    previous_level: effortLevel,
    selected_level: effortLevel,
  }),
  integration_add: product(standardStages, 2, {
    integration_family: integrationFamily,
    integration_hash: hash(),
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  integration_auth: product(standardStages, 2, {
    integration_family: integrationFamily,
    integration_hash: hash(),
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  integration_test: product(standardStages, 2, {
    integration_family: integrationFamily,
    integration_hash: hash(),
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  integration_toggle: product(["committed"], 2, {
    integration_family: integrationFamily,
    integration_hash: hash(),
    enabled: boolean(),
  }),
  integration_remove: product(["attempted", "succeeded", "failed"], 2, {
    integration_family: integrationFamily,
    integration_hash: hash(),
    reason_code: reasonCode,
  }),
  artifact_preview: product(["attempted", "succeeded", "failed"], 2, {
    artifact_type: artifactType,
    reason_code: reasonCode,
  }),
  artifact_open_external: product(["attempted", "succeeded", "failed"], 2, {
    artifact_type: artifactType,
    invocation_source: invocationSource,
    reason_code: reasonCode,
  }),
  artifact_save_as: product(standardStages, 2, {
    artifact_type: artifactType,
    size_bucket: bucket,
    invocation_source: invocationSource,
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  reel_create: product(standardStages, 2, {
    creation_source: string([
      "blank",
      "template",
      "duplicate",
      "import",
      "agent",
      "unknown",
    ]),
    aspect_ratio_family: string([
      "portrait",
      "landscape",
      "square",
      "other",
      "unknown",
    ]),
    reason_code: reasonCode,
    duration_ms: integer(),
  }),
  reel_open: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    item_count_bucket: bucket,
    reason_code: reasonCode,
  }),
  media_import: product(standardStages, 2, {
    media_type: mediaType,
    source_kind: string([
      "file_picker",
      "drag_drop",
      "photo_library",
      "generated",
      "agent",
      "unknown",
    ]),
    count_bucket: bucket,
    size_bucket: bucket,
    duration_bucket: durationBucket,
    reason_code: reasonCode,
  }),
  editor_session_summary: product(["reported"], 3, {
    duration_ms: integer(),
    reel_duration_bucket: durationBucket,
    media_item_count_bucket: bucket,
    add_count: integer(),
    delete_count: integer(),
    trim_count: integer(),
    split_count: integer(),
    move_count: integer(),
    resize_count: integer(),
    text_edit_count: integer(),
    style_change_count: integer(),
    undo_count: integer(),
    redo_count: integer(),
    playback_start_count: integer(),
    autosave_attempt_count: integer(),
    autosave_failure_count: integer(),
    export_attempted: boolean(),
    truncated_count: integer(),
    dropped_summary_count: integer(),
  }),
  caption_generation: product(standardStages, 2, {
    language: string([
      "en",
      "zh_hant",
      "zh_hans",
      "es",
      "fr",
      "de",
      "ja",
      "ko",
      "other",
      "unknown",
    ]),
    generation_mode: string([
      "automatic",
      "manual",
      "agent",
      "import",
      "unknown",
    ]),
    duration_ms: integer(),
    caption_count_bucket: bucket,
    reason_code: reasonCode,
  }),
  caption_style_change: product(["committed"], 3, {
    style_category: string([
      "font",
      "size",
      "color",
      "background",
      "position",
      "animation",
      "layout",
      "other",
      "unknown",
    ]),
    change_count: integer(),
  }),
  media_generation: product(standardStages, 2, {
    media_type: mediaType,
    ...modelProperties,
    duration_ms: integer(),
    reason_code: reasonCode,
  }),
  generated_media_insert: product(["attempted", "succeeded", "failed"], 2, {
    media_type: mediaType,
    destination_family: string([
      "canvas",
      "timeline",
      "library",
      "chat",
      "export",
      "other",
      "unknown",
    ]),
    reason_code: reasonCode,
  }),
  reel_export: product(
    [
      "attempted",
      "admitted",
      "preflight_failed",
      "succeeded",
      "failed",
      "cancelled",
    ],
    1,
    {
      preset: exportPreset,
      quality,
      width: integer(1, 32_768),
      height: integer(1, 32_768),
      duration_ms: integer(),
      result_size_bucket: bucket,
      invocation_source: invocationSource,
      reason_code: reasonCode,
    },
  ),
  setting_change: product(["committed", "reported"], 3, {
    setting_id: settingId,
    previous_value: settingValue,
    selected_value: settingValue,
    change_count: integer(),
  }),
  feedback_submission: product(
    ["opened", "attempted", "succeeded", "failed"],
    2,
    {
      category: string([
        "bug",
        "feature_request",
        "usability",
        "performance",
        "billing",
        "other",
        "unknown",
      ]),
      diagnostics_selected: boolean(),
      reason_code: reasonCode,
    },
  ),

  turn_summary: operational(
    ["succeeded", "failed", "cancelled", "interrupted"],
    1,
    {
      ...modelProperties,
      input_modality: inputModality,
      attachment_count_bucket: bucket,
      input_size_bucket: bucket,
      admission_duration_ms: integer(),
      first_visible_duration_ms: integer(),
      total_duration_ms: integer(),
      input_tokens: integer(),
      generated_tokens: integer(),
      cached_tokens: integer(),
      context_utilization: number(0, 1),
      compaction_count: integer(),
      retry_count: integer(),
      tool_total_count: integer(),
      tool_succeeded_count: integer(),
      tool_failed_count: integer(),
      tool_cancelled_count: integer(),
      tool_sequence: strings(toolFamilyValues),
      outcome_code: outcomeCode,
      last_phase: phase,
      complete: boolean(),
      omitted_tool_count: integer(),
    },
  ),
  turn_incident: operational(
    ["failed", "cancelled", "recovered"],
    0,
    optionalIncidentProperties,
    requiredIncidentProperties,
  ),
  tool_incident: operational(
    ["failed", "cancelled", "slow", "interrupted", "recovered"],
    0,
    {
      ...optionalIncidentProperties,
      tool_name: hash(),
      tool_family: toolFamily,
      tool_hash: hash(),
    },
    requiredIncidentProperties,
  ),
  operation_interrupted: operational(["interrupted"], 0, {
    operation_kind: string([
      "agent_turn",
      "tool_call",
      "media_generation",
      "export",
      "storage",
      "integration",
      "sidecar",
      "other",
      "unknown",
    ]),
    last_phase: phase,
    prior_launch_age_ms: integer(),
    complete: boolean(),
  }),
  sidecar_lifecycle: operational(
    [
      "startup",
      "ready",
      "exit",
      "restart_attempted",
      "restart_succeeded",
      "restart_failed",
    ],
    0,
    {
      ...incidentProperties,
      exit_code: integer(-1, 255),
      restart_count: integer(0, 100),
    },
  ),
  sidecar_connection: operational(
    ["connected", "lost", "reconnected", "permanently_failed"],
    0,
    { ...incidentProperties, reconnect_count: integer(0, 100) },
  ),
  storage_incident: operational(
    ["failed", "recovered"],
    0,
    optionalIncidentProperties,
    requiredIncidentProperties,
  ),
  integration_incident: operational(["failed", "recovered"], 0, {
    ...optionalIncidentProperties,
    integration_family: integrationFamily,
    integration_hash: hash(),
  }, requiredIncidentProperties),
  media_generation_incident: operational(["failed", "recovered"], 0, {
    ...optionalIncidentProperties,
    media_type: mediaType,
    ...modelProperties,
  }, requiredIncidentProperties),
  export_incident: operational(["preflight_failed", "failed", "recovered"], 0, {
    ...optionalIncidentProperties,
    preset: exportPreset,
    quality,
  }, requiredIncidentProperties),
  telemetry_delivery_summary: operational(["reported"], 3, {
    recorded_count: integer(),
    persisted_count: integer(),
    accepted_count: integer(),
    permanently_rejected_count: integer(),
    failed_batch_count: integer(),
    dropped_count: integer(),
    dropped_priorities: numbers(),
    oldest_queued_age_ms: integer(),
    ready_count: integer(),
    retrying_count: integer(),
    queued_bytes: integer(),
    interrupted_operation_count: integer(),
    truncated_summary_count: integer(),
  }),
};

export const catalogFixtureV1 = {
  catalog_version: 1,
  events: Object.fromEntries(
    Object.entries(TELEMETRY_CATALOG_V1).map(([eventName, entry]) => [
      eventName,
      {
        stream: entry.stream,
        allowed_stages: [...entry.stages],
        priority: entry.priority,
        required_properties: Object.keys(entry.requiredProperties),
        optional_properties: Object.keys(entry.optionalProperties),
      },
    ]),
  ),
};
