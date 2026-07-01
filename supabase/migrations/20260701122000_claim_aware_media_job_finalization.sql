create or replace function public.settle_claimed_media_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_final_cost_usd_micros bigint,
  p_output jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_claim_token is null then
    raise exception 'media_job_missing_claim_token';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and type = 'media_job'
    and claim_token = p_claim_token
    and (claim_expires_at is null or claim_expires_at >= now())
  for update;

  if v_job.id is null then
    raise exception 'media_job_stale_claim';
  end if;

  return public.settle_balance_reservation(
    p_job_id,
    p_final_cost_usd_micros,
    p_output,
    p_metadata
  );
end;
$$;

create or replace function public.record_and_settle_claimed_media_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_final_cost_usd_micros bigint,
  p_output jsonb default null,
  p_metadata jsonb default '{}'::jsonb,
  p_usage_event jsonb default '{}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_provider text;
  v_model text;
  v_operation text;
  v_raw_provider_cost numeric(18, 9);
  v_charged_amount_usd_micros bigint;
  v_markup_amount_usd_micros bigint;
  v_usage_metadata jsonb;
begin
  if p_claim_token is null then
    raise exception 'media_job_missing_claim_token';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and type = 'media_job'
    and claim_token = p_claim_token
    and (claim_expires_at is null or claim_expires_at >= now())
  for update;

  if v_job.id is null then
    raise exception 'media_job_stale_claim';
  end if;

  v_provider := coalesce(nullif(p_usage_event->>'provider', ''), v_job.provider);
  v_model := coalesce(nullif(p_usage_event->>'model', ''), v_job.model);
  v_operation := coalesce(nullif(p_usage_event->>'operation', ''), v_job.input->>'operation');

  if v_operation is null then
    raise exception 'usage_event_operation_required';
  end if;

  v_raw_provider_cost := coalesce(nullif(p_usage_event->>'raw_provider_cost', '')::numeric(18, 9), 0);
  v_charged_amount_usd_micros := coalesce(
    nullif(p_usage_event->>'charged_amount_usd_micros', '')::bigint,
    p_final_cost_usd_micros
  );
  v_markup_amount_usd_micros := coalesce(
    nullif(p_usage_event->>'markup_amount_usd_micros', '')::bigint,
    0
  );
  v_usage_metadata := coalesce(p_usage_event->'metadata', '{}'::jsonb);

  if v_charged_amount_usd_micros <> p_final_cost_usd_micros then
    raise exception 'usage_event_charge_mismatch';
  end if;

  if not exists (
    select 1
    from public.usage_events
    where job_id = p_job_id
  ) then
    insert into public.usage_events (
      user_id,
      job_id,
      provider,
      model,
      operation,
      input_units,
      output_units,
      reasoning_units,
      cached_units,
      raw_provider_cost,
      charged_amount_usd_micros,
      markup_amount_usd_micros,
      metadata
    )
    values (
      v_job.user_id,
      p_job_id,
      v_provider,
      v_model,
      v_operation,
      coalesce(nullif(p_usage_event->>'input_units', '')::bigint, 0),
      coalesce(nullif(p_usage_event->>'output_units', '')::bigint, 0),
      coalesce(nullif(p_usage_event->>'reasoning_units', '')::bigint, 0),
      coalesce(nullif(p_usage_event->>'cached_units', '')::bigint, 0),
      v_raw_provider_cost,
      v_charged_amount_usd_micros,
      v_markup_amount_usd_micros,
      v_usage_metadata
    );
  end if;

  return public.settle_balance_reservation(
    p_job_id,
    p_final_cost_usd_micros,
    p_output,
    p_metadata
  );
end;
$$;

create or replace function public.release_claimed_media_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_status text default 'failed',
  p_error text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_job public.generation_jobs%rowtype;
begin
  if p_claim_token is null then
    raise exception 'media_job_missing_claim_token';
  end if;

  select *
  into v_job
  from public.generation_jobs
  where id = p_job_id
    and type = 'media_job'
    and claim_token = p_claim_token
    and (claim_expires_at is null or claim_expires_at >= now())
  for update;

  if v_job.id is null then
    raise exception 'media_job_stale_claim';
  end if;

  return public.release_balance_reservation(
    p_job_id,
    p_status,
    p_error,
    p_metadata
  );
end;
$$;

revoke all on function public.settle_claimed_media_job(uuid, uuid, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_claimed_media_job(uuid, uuid, bigint, jsonb, jsonb)
  to service_role;

revoke all on function public.record_and_settle_claimed_media_job(uuid, uuid, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_and_settle_claimed_media_job(uuid, uuid, bigint, jsonb, jsonb, jsonb)
  to service_role;

revoke all on function public.release_claimed_media_job(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.release_claimed_media_job(uuid, uuid, text, text, jsonb)
  to service_role;
