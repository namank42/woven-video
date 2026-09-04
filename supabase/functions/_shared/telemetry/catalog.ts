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

const string = (values?: readonly string[]): TelemetryPropertyRule => ({
  type: "string",
  ...(values ? { enum: values } : {}),
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
const strings = (): TelemetryPropertyRule => ({ type: "string_array" });
const numbers = (): TelemetryPropertyRule => ({ type: "number_array" });

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
  error_code: string(),
  component: string(),
  phase: string(),
  severity: string(["info", "warning", "error", "critical"]),
  user_visible: boolean(),
  retryable: boolean(),
  transient: boolean(),
  attempt_number: integer(0, 100),
  recovery_action: string(),
  recovery_outcome: string(),
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
  model_id: string(),
  model_family: string(),
  model_hash: hash(),
  provider_family: string(),
  access_mode: string(["woven", "bring_your_own_key", "chatgpt_codex"]),
  effort_level: string(),
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
      launch_reason: string(),
      prior_version: string(),
      duration_ms: integer(),
    },
  ),
  app_update: product(
    ["available", "started", "installed", "failed", "dismissed"],
    2,
    {
      from_version: string(),
      to_version: string(),
      automatic: boolean(),
      reason_code: string(),
    },
  ),
  surface_viewed: product(["viewed"], 3, {
    surface: string(),
    invocation_source: invocationSource,
  }),
  desktop_command: product(["invoked", "succeeded", "failed", "cancelled"], 2, {
    action: string(),
    invocation_source: invocationSource,
    reason_code: string(),
  }),
  sign_in: product(["attempted", "succeeded", "failed", "cancelled"], 2, {
    provider: string(),
    reason_code: string(),
  }),
  sign_out: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    reason_code: string(),
  }),
  entitlement_refresh: product(["attempted", "succeeded", "failed"], 2, {
    entitlement_state: string(),
    source_kind: string(),
    reason_code: string(),
  }),
  paywall_viewed: product(["viewed"], 3, {
    entry_point: string(),
    entitlement_state: string(),
  }),
  checkout: product(["attempted", "succeeded", "failed", "cancelled"], 2, {
    offer_id: string(),
    plan_id: string(),
    reason_code: string(),
  }),
  trial_activation: product(
    ["offered", "attempted", "succeeded", "failed"],
    2,
    {
      offer_id: string(),
      reason_code: string(),
    },
  ),
  onboarding: product(["started", "completed", "skipped"], 2, {
    entry_reason: string(),
    duration_ms: integer(),
  }),
  onboarding_step: product(["viewed", "completed"], 3, { step_id: string() }),
  workspace_create: product(standardStages, 2, {
    invocation_source: invocationSource,
    template_kind: string(),
    reason_code: string(),
    duration_ms: integer(),
  }),
  workspace_open: product(standardStages, 2, {
    invocation_source: invocationSource,
    open_source: string(["recent", "manual", "import", "system"]),
    reason_code: string(),
    duration_ms: integer(),
  }),
  workspace_import: product(standardStages, 2, {
    invocation_source: invocationSource,
    import_kind: string(),
    size_bucket: string(),
    reason_code: string(),
    duration_ms: integer(),
  }),
  workspace_switch: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    reason_code: string(),
  }),
  chat_create: product(standardStages, 2, {
    invocation_source: invocationSource,
    reason_code: string(),
    duration_ms: integer(),
  }),
  chat_open: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    reason_code: string(),
  }),
  chat_archive: product(["attempted", "succeeded", "failed"], 2, {
    action: string(["archive", "unarchive"]),
    invocation_source: invocationSource,
    reason_code: string(),
  }),
  message_send: product(["attempted", "admitted", "rejected"], 2, {
    input_modality: string(),
    attachment_count_bucket: string(),
    rejection_code: string(),
  }),
  attachment_add: product(standardStages, 2, {
    attachment_type: string(),
    source_kind: string(),
    count_bucket: string(),
    size_bucket: string(),
    reason_code: string(),
  }),
  agent_turn: product(
    ["started", "succeeded", "failed", "cancelled", "interrupted"],
    1,
    {
      ...modelProperties,
      duration_ms: integer(),
      duration_bucket: string(),
      outcome_code: string(),
    },
  ),
  agent_retry: product(["attempted", "admitted", "rejected"], 2, {
    prior_attempt_number: integer(0, 100),
    trigger: string(),
    rejection_code: string(),
  }),
  agent_cancel: product(["requested", "acknowledged", "failed"], 1, {
    phase: string(),
    reason_code: string(),
  }),
  model_change: product(["committed"], 2, {
    previous_model_id: string(),
    selected_model_id: string(),
    previous_model_family: string(),
    selected_model_family: string(),
    previous_model_hash: hash(),
    selected_model_hash: hash(),
  }),
  access_mode_change: product(["committed"], 2, {
    previous_mode: string(["woven", "bring_your_own_key", "chatgpt_codex"]),
    selected_mode: string(["woven", "bring_your_own_key", "chatgpt_codex"]),
  }),
  reasoning_change: product(["committed"], 2, {
    previous_level: string(),
    selected_level: string(),
  }),
  integration_add: product(standardStages, 2, {
    integration_family: string(),
    integration_hash: hash(),
    reason_code: string(),
    duration_ms: integer(),
  }),
  integration_auth: product(standardStages, 2, {
    integration_family: string(),
    integration_hash: hash(),
    reason_code: string(),
    duration_ms: integer(),
  }),
  integration_test: product(standardStages, 2, {
    integration_family: string(),
    integration_hash: hash(),
    reason_code: string(),
    duration_ms: integer(),
  }),
  integration_toggle: product(["committed"], 2, {
    integration_family: string(),
    integration_hash: hash(),
    enabled: boolean(),
  }),
  integration_remove: product(["attempted", "succeeded", "failed"], 2, {
    integration_family: string(),
    integration_hash: hash(),
    reason_code: string(),
  }),
  artifact_preview: product(["attempted", "succeeded", "failed"], 2, {
    artifact_type: string(),
    reason_code: string(),
  }),
  artifact_open_external: product(["attempted", "succeeded", "failed"], 2, {
    artifact_type: string(),
    invocation_source: invocationSource,
    reason_code: string(),
  }),
  artifact_save_as: product(standardStages, 2, {
    artifact_type: string(),
    size_bucket: string(),
    invocation_source: invocationSource,
    reason_code: string(),
    duration_ms: integer(),
  }),
  reel_create: product(standardStages, 2, {
    creation_source: string(),
    aspect_ratio_family: string(),
    reason_code: string(),
    duration_ms: integer(),
  }),
  reel_open: product(["attempted", "succeeded", "failed"], 2, {
    invocation_source: invocationSource,
    item_count_bucket: string(),
    reason_code: string(),
  }),
  media_import: product(standardStages, 2, {
    media_type: string(),
    source_kind: string(),
    count_bucket: string(),
    size_bucket: string(),
    duration_bucket: string(),
    reason_code: string(),
  }),
  editor_session_summary: product(["reported"], 3, {
    duration_ms: integer(),
    reel_duration_bucket: string(),
    media_item_count_bucket: string(),
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
    language: string(),
    generation_mode: string(),
    duration_ms: integer(),
    caption_count_bucket: string(),
    reason_code: string(),
  }),
  caption_style_change: product(["committed"], 3, {
    style_category: string(),
    change_count: integer(),
  }),
  media_generation: product(standardStages, 2, {
    media_type: string(),
    ...modelProperties,
    duration_ms: integer(),
    reason_code: string(),
  }),
  generated_media_insert: product(["attempted", "succeeded", "failed"], 2, {
    media_type: string(),
    destination_family: string(),
    reason_code: string(),
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
      preset: string(),
      quality: string(),
      width: integer(1, 32_768),
      height: integer(1, 32_768),
      duration_ms: integer(),
      result_size_bucket: string(),
      invocation_source: invocationSource,
      reason_code: string(),
    },
  ),
  setting_change: product(["committed", "reported"], 3, {
    setting_id: string(),
    previous_value: hash(),
    selected_value: hash(),
    change_count: integer(),
  }),
  feedback_submission: product(
    ["opened", "attempted", "succeeded", "failed"],
    2,
    {
      category: string(),
      diagnostics_selected: boolean(),
      reason_code: string(),
    },
  ),

  turn_summary: operational(
    ["succeeded", "failed", "cancelled", "interrupted"],
    1,
    {
      ...modelProperties,
      input_modality: string(),
      attachment_count_bucket: string(),
      input_size_bucket: string(),
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
      tool_sequence: strings(),
      outcome_code: string(),
      last_phase: string(),
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
      tool_name: string(),
      tool_family: string(),
      tool_hash: hash(),
    },
    requiredIncidentProperties,
  ),
  operation_interrupted: operational(["interrupted"], 0, {
    operation_kind: string(),
    last_phase: string(),
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
    integration_family: string(),
    integration_hash: hash(),
  }, requiredIncidentProperties),
  media_generation_incident: operational(["failed", "recovered"], 0, {
    ...optionalIncidentProperties,
    media_type: string(),
    ...modelProperties,
  }, requiredIncidentProperties),
  export_incident: operational(["preflight_failed", "failed", "recovered"], 0, {
    ...optionalIncidentProperties,
    preset: string(),
    quality: string(),
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
