-- Consolidate the start and settle phases of flat-fee tool calls into single
-- RPCs. Cuts the success path from 5 DB round trips (insert job, reserve,
-- update job, insert usage_event, settle) to 2 (start, settle).
--
-- Internally these still call the existing primitives (reserve_balance,
-- settle_balance_reservation, insert_ledger_entry) so any future change to
-- those flows propagates here. Failure path still uses
-- release_balance_reservation directly — no change needed.

create or replace function public.start_flat_tool_call(
  p_user_id uuid,
  p_provider text,
  p_model text,
  p_operation text,
  p_job_type text,
  p_amount_usd_micros bigint,
  p_input jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job_id uuid;
begin
  insert into public.generation_jobs (
    user_id,
    type,
    provider,
    model,
    status,
    estimated_cost_usd_micros,
    input,
    started_at
  )
  values (
    p_user_id,
    p_job_type,
    p_provider,
    p_model,
    'running',
    p_amount_usd_micros,
    p_input,
    now()
  )
  returning id into v_job_id;

  perform public.reserve_balance(
    p_user_id,
    v_job_id,
    p_amount_usd_micros,
    jsonb_build_object(
      'provider', p_provider,
      'model', p_model,
      'operation', p_operation
    )
  );

  return v_job_id;
end;
$$;

create or replace function public.settle_flat_tool_call(
  p_job_id uuid,
  p_operation text,
  p_final_cost_usd_micros bigint,
  p_raw_provider_cost numeric default 0,
  p_metadata jsonb default '{}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_raw_cost_micros bigint;
  v_markup_micros bigint;
  v_settle_metadata jsonb;
begin
  v_settle_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'raw_provider_cost', p_raw_provider_cost,
    'charged_amount_usd_micros', p_final_cost_usd_micros,
    'flat_fee', true
  );

  v_job := public.settle_balance_reservation(
    p_job_id,
    p_final_cost_usd_micros,
    null,
    v_settle_metadata
  );

  v_raw_cost_micros := greatest(
    0,
    ceil(coalesce(p_raw_provider_cost, 0) * 1000000)::bigint
  );
  v_markup_micros := greatest(
    0,
    p_final_cost_usd_micros - v_raw_cost_micros
  );

  insert into public.usage_events (
    user_id,
    job_id,
    provider,
    model,
    operation,
    raw_provider_cost,
    charged_amount_usd_micros,
    markup_amount_usd_micros,
    metadata
  )
  values (
    v_job.user_id,
    p_job_id,
    v_job.provider,
    v_job.model,
    p_operation,
    coalesce(p_raw_provider_cost, 0),
    p_final_cost_usd_micros,
    v_markup_micros,
    v_settle_metadata
  );

  return v_job;
end;
$$;

revoke all on function public.start_flat_tool_call(uuid, text, text, text, text, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.settle_flat_tool_call(uuid, text, bigint, numeric, jsonb)
  from public, anon, authenticated;

grant execute on function public.start_flat_tool_call(uuid, text, text, text, text, bigint, jsonb)
  to service_role;
grant execute on function public.settle_flat_tool_call(uuid, text, bigint, numeric, jsonb)
  to service_role;
