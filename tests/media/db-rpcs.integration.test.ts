import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listMediaModels } from "@/lib/media/model-registry";

const runDbTests = process.env.RUN_SUPABASE_DB_TESTS === "1";
const describeDb = runDbTests ? describe : describe.skip;

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function getAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when RUN_SUPABASE_DB_TESTS=1.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

describeDb("media SQL RPC integration", () => {
  it("lists the enabled production media catalog seeded from the pricing page", async () => {
    const models = await listMediaModels();
    const ids = new Set(models.map((model) => model.id));

    expect(ids.has("fal:launch-placeholder-video")).toBe(false);
    expect(ids.has("openai/gpt-image-2")).toBe(true);
    expect(ids.has("openai/gpt-image-2/edit")).toBe(true);
    expect(ids.has("fal-ai/nano-banana-pro")).toBe(true);
    expect(ids.has("fal-ai/nano-banana-lite")).toBe(true);
    expect(ids.has("fal-ai/nano-banana-lite/edit")).toBe(true);
    expect(ids.has("fal-ai/veo3.1")).toBe(true);
    expect(ids.has("bytedance/seedance-2.0/text-to-video")).toBe(true);
    expect(ids.has("fal-ai/kling-video/v3/pro/text-to-video")).toBe(true);
    expect(ids.has("music_v2")).toBe(true);

    expect(models.find((model) => model.id === "fal-ai/veo3.1/first-last-frame-to-video")).toMatchObject({
      provider: "fal",
      kind: "video",
      inputAssetSchema: {
        roles: expect.arrayContaining([
          expect.objectContaining({ role: "first_frame", providerField: "first_frame_url" }),
          expect.objectContaining({ role: "last_frame", providerField: "last_frame_url" }),
        ]),
      },
    });
  });

  it("does not claim creating or unreserved queued jobs", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    await insertMediaJob({ userId, accountId, status: "creating", reserved: 0 });
    await insertMediaJob({ userId, accountId, status: "queued", reserved: 0 });

    const { data, error } = await admin.rpc("claim_media_jobs", {
      p_limit: 10,
      p_lease_seconds: 300,
    });

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("claims a reserved queued job only once under concurrent claims", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });

    const [first, second] = await Promise.all([
      admin.rpc("claim_media_jobs", { p_limit: 1, p_lease_seconds: 300 }),
      admin.rpc("claim_media_jobs", { p_limit: 1, p_lease_seconds: 300 }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const claimedIds = [...(first.data ?? []), ...(second.data ?? [])].map((job) => job.id);
    expect(claimedIds).toEqual([jobId]);
  });

  it("claims the requested reserved media job by id only once", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const targetJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });
    const otherJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });

    const [first, second] = await Promise.all([
      admin.rpc("claim_media_job_by_id", { p_job_id: targetJobId, p_lease_seconds: 300 }),
      admin.rpc("claim_media_job_by_id", { p_job_id: targetJobId, p_lease_seconds: 300 }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data?.id ?? second.data?.id).toBe(targetJobId);
    expect([first.data?.id, second.data?.id].filter((id): id is string => id === targetJobId)).toHaveLength(1);

    const { data: otherClaim, error: otherError } = await admin.rpc("claim_media_job_by_id", {
      p_job_id: otherJobId,
      p_lease_seconds: 300,
    });
    expect(otherError).toBeNull();
    expect(otherClaim.id).toBe(otherJobId);
  });

  it("does not exact-claim terminal jobs or unreserved queued jobs", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const failedJobId = await insertMediaJob({ userId, accountId, status: "failed", reserved: 100000 });
    const unreservedJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 0 });

    const failedClaim = await admin.rpc("claim_media_job_by_id", {
      p_job_id: failedJobId,
      p_lease_seconds: 300,
    });
    const unreservedClaim = await admin.rpc("claim_media_job_by_id", {
      p_job_id: unreservedJobId,
      p_lease_seconds: 300,
    });

    expect(failedClaim.error).toBeNull();
    expect(failedClaim.data?.id).toBeNull();
    expect(unreservedClaim.error).toBeNull();
    expect(unreservedClaim.data?.id).toBeNull();
  });

  it("finds stale media jobs for Trigger reconciliation", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const queuedJobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });
    const runningJobId = await insertMediaJob({ userId, accountId, status: "running", reserved: 100000 });
    const succeededJobId = await insertMediaJob({ userId, accountId, status: "succeeded", reserved: 100000 });

    await admin
      .from("generation_jobs")
      .update({ claim_expires_at: "1970-01-01T00:00:00.000Z" })
      .eq("id", runningJobId);

    const { data, error } = await admin.rpc("find_media_jobs_for_trigger_reconciliation", {
      p_limit: 25,
      p_now: new Date().toISOString(),
    });

    expect(error).toBeNull();
    const rows = new Map((data ?? []).map((row) => [row.id, row]));
    expect(rows.get(queuedJobId)).toMatchObject({
      user_id: userId,
      media_model_id: "frontier-video",
      media_kind: "video",
    });
    expect(rows.get(runningJobId)).toMatchObject({
      user_id: userId,
      media_model_id: "frontier-video",
      media_kind: "video",
    });
    expect(rows.has(succeededJobId)).toBe(false);
  });

  it("rejects settlement with a stale claim token", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });
    const { data: claimed } = await admin.rpc("claim_media_job_by_id", {
      p_job_id: jobId,
      p_lease_seconds: 300,
    });
    const staleToken = randomUUID();

    const { error } = await admin.rpc("release_claimed_media_job", {
      p_job_id: jobId,
      p_claim_token: staleToken,
      p_status: "failed",
      p_error: "provider_failed",
      p_metadata: { reason: "provider_failed" },
    });

    expect(claimed?.id).toBe(jobId);
    expect(error?.message).toBe("media_job_stale_claim");
  });

  it("cancels only queued jobs owned by the user", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertMediaJob({ userId, accountId, status: "queued", reserved: 100000 });

    const { data, error } = await admin.rpc("cancel_queued_media_job", {
      p_user_id: userId,
      p_job_id: jobId,
    });

    expect(error).toBeNull();
    expect(data.status).toBe("cancelled");
  });

  it("claims attached input assets for terminal caption jobs", async () => {
    const admin = getAdminClient();
    const { userId, accountId } = await createUserAndAccount();
    const jobId = await insertCaptionJob({
      userId,
      accountId,
      status: "succeeded",
    });
    const assetId = randomUUID();
    const storageKey = `users/${userId}/media/tmp/${assetId}/input.wav`;

    const { error: assetError } = await admin
      .from("media_assets")
      .insert({
        id: assetId,
        user_id: userId,
        job_id: jobId,
        kind: "input",
        status: "attached",
        content_type: "audio/wav",
        size_bytes: 1234,
        storage_key: storageKey,
      });
    if (assetError) throw assetError;

    const { data, error } = await admin.rpc("claim_expired_media_assets_for_deletion", {
      p_now: new Date().toISOString(),
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(data ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assetId, storage_key: storageKey }),
    ]));
  });
});

async function createUserAndAccount() {
  const admin = getAdminClient();
  const email = `media-${randomUUID()}@example.test`;
  const { data: userResult, error: userError } = await admin.auth.admin.createUser({
    email,
    password: `A1-${randomUUID()}`,
    email_confirm: true,
  });
  if (userError) throw userError;
  const userId = userResult.user.id;

  const { data: account, error: accountError } = await admin
    .from("billing_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("currency", "usd")
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) {
    throw new Error(`billing account missing for user ${userId}`);
  }

  return { userId, accountId: account.id as string };
}

async function insertMediaJob({
  userId,
  accountId,
  status,
  reserved,
}: {
  userId: string;
  accountId: string;
  status: string;
  reserved: number;
}) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("generation_jobs")
    .insert({
      user_id: userId,
      account_id: accountId,
      type: "media_job",
      provider: "fal",
      model: "fal-ai/frontier-video",
      status,
      estimated_cost_usd_micros: 100000,
      reserved_amount_usd_micros: reserved,
      input: {
        media_model_id: "frontier-video",
        operation: "video_generation",
        parameters: { prompt: "test" },
        input_asset_ids: [],
      },
      progress: {},
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

async function insertCaptionJob({
  userId,
  accountId,
  status,
}: {
  userId: string;
  accountId: string;
  status: string;
}) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("generation_jobs")
    .insert({
      user_id: userId,
      account_id: accountId,
      type: "reel_captions",
      provider: "elevenlabs",
      model: "scribe_v2",
      status,
      estimated_cost_usd_micros: 100000,
      reserved_amount_usd_micros: 0,
      input: {
        duration_seconds: 12,
        filename: "voice.wav",
        content_type: "audio/wav",
      },
      output: {},
      progress: {},
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}
