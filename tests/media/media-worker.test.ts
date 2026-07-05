import { afterEach, describe, expect, it, vi } from "vitest";
import mediaWorker from "@/workers/media";
import { signMediaToken } from "@/lib/media/tokens";

type WorkerEnv = {
  MEDIA_BUCKET: FakeBucket;
  MEDIA_TOKEN_SECRET: string;
  MEDIA_WORKER_SHARED_SECRET: string;
  WOVEN_API_BASE_URL: string;
  MEDIA_MAX_UPLOAD_BYTES: string;
  UPLOAD_COMPLETION_MODE?: string;
};

type PutRecord = {
  key: string;
  text: string;
  options: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | undefined;
};

class FakeBucket {
  readonly objects = new Map<string, FakeObject>();
  readonly puts: PutRecord[] = [];
  readonly deletes: string[] = [];

  async put(
    key: string,
    value: ReadableStream,
    options?: PutRecord["options"],
  ): Promise<void> {
    const text = await new Response(value).text();
    this.puts.push({ key, text, options });
    this.setObject(key, text, {
      contentType: options?.httpMetadata?.contentType,
      etag: `"${key}-etag"`,
    });
  }

  async get(key: string): Promise<FakeObject | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    this.deletes.push(...keys);
    for (const objectKey of keys) {
      this.objects.delete(objectKey);
    }
  }

  setObject(
    key: string,
    body: string,
    metadata: { contentType?: string; etag?: string } = {},
  ): void {
    this.objects.set(key, new FakeObject(body, metadata));
  }
}

class FakeObject {
  readonly body: ReadableStream;
  readonly httpEtag: string;

  constructor(
    body: string,
    private readonly metadata: { contentType?: string; etag?: string },
  ) {
    this.body = new Response(body).body!;
    this.httpEtag = metadata.etag ?? '"fake-etag"';
  }

  writeHttpMetadata(headers: Headers): void {
    if (this.metadata.contentType) {
      headers.set("content-type", this.metadata.contentType);
    }
  }
}

describe("media Worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes valid uploads to R2 and calls the completion endpoint", async () => {
    const env = testEnv();
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 14,
    });
    const completionFetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/asset_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          "content-length": "14",
        },
        body: "uploaded bytes",
      },
    ), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(env.MEDIA_BUCKET.puts).toEqual([{
      key: "users/user_1/media/tmp/asset_1/input.png",
      text: "uploaded bytes",
      options: {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { "user-id": "user_1", "asset-id": "asset_1" },
      },
    }]);
    expect(completionFetch).toHaveBeenCalledWith(
      "https://app.example.test/api/internal/media/uploads/complete",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-woven-media-worker-secret": "worker-secret",
        },
        body: JSON.stringify({
          asset_id: "asset_1",
          storage_key: "users/user_1/media/tmp/asset_1/input.png",
          size_bytes: 14,
        }),
      }),
    );
  });

  it("writes valid input uploads in manual mode without calling the completion endpoint", async () => {
    const env = testEnv({ uploadCompletionMode: "manual" });
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 14,
    });
    const completionFetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/asset_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          "content-length": "14",
        },
        body: "uploaded bytes",
      },
    ), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(env.MEDIA_BUCKET.puts).toEqual([{
      key: "users/user_1/media/tmp/asset_1/input.png",
      text: "uploaded bytes",
      options: {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { "user-id": "user_1", "asset-id": "asset_1" },
      },
    }]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("rejects unknown upload completion modes before storing the upload", async () => {
    const env = testEnv({ uploadCompletionMode: "client" });
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 5,
    });
    const completionFetch = vi.fn();
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(uploadRequest("asset_1", token, {
      body: "hello",
      contentLength: "5",
    }), env);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Invalid upload completion mode");
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("writes valid output uploads to R2 without calling the completion endpoint", async () => {
    const env = testEnv();
    const outputKey = "users/user_1/media/outputs/job_1/output_1/attempts/attempt_1/output.mp4";
    const token = await uploadToken({
      assetId: "output_1",
      contentType: "video/mp4",
      key: outputKey,
      jobId: "job_1",
      sizeBytes: 12,
    });
    const completionFetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/output_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "video/mp4",
          "content-length": "12",
        },
        body: "video bytes!",
      },
    ), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(env.MEDIA_BUCKET.puts).toEqual([{
      key: outputKey,
      text: "video bytes!",
      options: {
        httpMetadata: { contentType: "video/mp4" },
        customMetadata: { "user-id": "user_1", "asset-id": "output_1", "job-id": "job_1" },
      },
    }]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("rejects output uploads using the old final-key shape", async () => {
    const env = testEnv();
    const token = await uploadToken({
      assetId: "output_1",
      contentType: "video/mp4",
      key: "users/user_1/media/outputs/job_1/output_1.mp4",
      jobId: "job_1",
      sizeBytes: 5,
    });
    const completionFetch = vi.fn();
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/output_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "video/mp4",
          "content-length": "5",
        },
        body: "video",
      },
    ), env);

    expect(response.status).toBe(401);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("rejects output uploads with unsafe attempt key segments", async () => {
    const env = testEnv();
    const token = await uploadToken({
      assetId: "output_1",
      contentType: "video/mp4",
      key: "users/user_1/media/outputs/job_1/output_1/attempts/attempt.1/output.mp4",
      jobId: "job_1",
      sizeBytes: 5,
    });
    const completionFetch = vi.fn();
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/output_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "video/mp4",
          "content-length": "5",
        },
        body: "video",
      },
    ), env);

    expect(response.status).toBe(401);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("rejects output uploads when the key does not match the token job output path", async () => {
    const env = testEnv();
    const token = await uploadToken({
      assetId: "output_1",
      contentType: "video/mp4",
      key: "users/user_1/media/outputs/job_2/output_1/attempts/attempt_1/output.mp4",
      jobId: "job_1",
      sizeBytes: 5,
    });
    const completionFetch = vi.fn();
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/output_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "video/mp4",
          "content-length": "5",
        },
        body: "video",
      },
    ), env);

    expect(response.status).toBe(401);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("rejects uploads when content type does not match the token", async () => {
    const env = testEnv();
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 5,
    });
    const completionFetch = vi.fn();
    vi.stubGlobal("fetch", completionFetch);

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/asset_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "text/plain",
          "content-length": "5",
        },
        body: "hello",
      },
    ), env);

    expect(response.status).toBe(400);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
    expect(completionFetch).not.toHaveBeenCalled();
  });

  it("rejects uploads when the route asset does not match the token asset", async () => {
    const env = testEnv();
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 5,
    });

    const response = await mediaWorker.fetch(uploadRequest("asset_2", token, {
      body: "hello",
      contentLength: "5",
    }), env);

    expect(response.status).toBe(401);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
  });

  it("rejects upload tokens missing content type or size bytes", async () => {
    const env = testEnv();
    const missingContentType = await signMediaToken({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      assetId: "asset_1",
      sizeBytes: 5,
      exp: futureExp(),
    }, "token-secret");
    const missingSizeBytes = await signMediaToken({
      kind: "upload",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      assetId: "asset_1",
      contentType: "image/png",
      exp: futureExp(),
    }, "token-secret");

    const contentTypeResponse = await mediaWorker.fetch(uploadRequest(
      "asset_1",
      missingContentType,
      { body: "hello", contentLength: "5" },
    ), env);
    const sizeBytesResponse = await mediaWorker.fetch(uploadRequest(
      "asset_1",
      missingSizeBytes,
      { body: "hello", contentLength: "5" },
    ), env);

    expect(contentTypeResponse.status).toBe(401);
    expect(sizeBytesResponse.status).toBe(401);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
  });

  it("rejects upload tokens whose key is outside the user asset temp prefix", async () => {
    const env = testEnv();
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_2/input.png",
      sizeBytes: 5,
    });

    const response = await mediaWorker.fetch(uploadRequest("asset_1", token, {
      body: "hello",
      contentLength: "5",
    }), env);

    expect(response.status).toBe(401);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
  });

  it("rejects download tokens used for uploads", async () => {
    const env = testEnv();
    const token = await signMediaToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/tmp/asset_1/input.png",
      exp: futureExp(),
    }, "token-secret");

    const response = await mediaWorker.fetch(uploadRequest("asset_1", token, {
      body: "hello",
      contentLength: "5",
    }), env);

    expect(response.status).toBe(401);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
  });

  it("requires Content-Length for uploads", async () => {
    const env = testEnv();
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 5,
    });

    const response = await mediaWorker.fetch(uploadRequest("asset_1", token, {
      body: "hello",
      contentLength: null,
    }), env);

    expect(response.status).toBe(411);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
  });

  it("rejects uploads larger than the configured cap", async () => {
    const env = testEnv({ maxUploadBytes: "3" });
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 4,
    });

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/uploads/asset_1?token=${token}`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/png",
          "content-length": "4",
        },
        body: "data",
      },
    ), env);

    expect(response.status).toBe(413);
    expect(env.MEDIA_BUCKET.puts).toEqual([]);
  });

  it("deletes the R2 object when the completion callback fails", async () => {
    const env = testEnv();
    const token = await uploadToken({
      key: "users/user_1/media/tmp/asset_1/input.png",
      sizeBytes: 14,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const response = await mediaWorker.fetch(uploadRequest("asset_1", token, {
      body: "uploaded bytes",
      contentLength: "14",
    }), env);

    expect(response.status).toBe(502);
    expect(env.MEDIA_BUCKET.puts).toHaveLength(1);
    expect(env.MEDIA_BUCKET.deletes).toEqual([
      "users/user_1/media/tmp/asset_1/input.png",
    ]);
    expect(env.MEDIA_BUCKET.objects.has("users/user_1/media/tmp/asset_1/input.png")).toBe(false);
  });

  it("returns object bodies and metadata for valid downloads", async () => {
    const env = testEnv();
    env.MEDIA_BUCKET.setObject(
      "users/user_1/media/outputs/job_1/out_1.mp4",
      "downloaded bytes",
      { contentType: "video/mp4", etag: '"object-etag"' },
    );
    const token = await signMediaToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      assetId: "out_1",
      exp: futureExp(),
    }, "token-secret");

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/objects/out_1?token=${token}`,
    ), env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("downloaded bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("etag")).toBe('"object-etag"');
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("rejects downloads when the route asset does not match the token asset", async () => {
    const env = testEnv();
    env.MEDIA_BUCKET.setObject(
      "users/user_1/media/outputs/job_1/out_1.mp4",
      "downloaded bytes",
      { contentType: "video/mp4" },
    );
    const token = await signMediaToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      assetId: "out_1",
      exp: futureExp(),
    }, "token-secret");

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/objects/out_2?token=${token}`,
    ), env);

    expect(response.status).toBe(401);
  });

  it("rejects downloads when the token omits an asset id", async () => {
    const env = testEnv();
    env.MEDIA_BUCKET.setObject(
      "users/user_1/media/outputs/job_1/out_1.mp4",
      "downloaded bytes",
      { contentType: "video/mp4" },
    );
    const token = await signMediaToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: futureExp(),
    }, "token-secret");

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/objects/out_1?token=${token}`,
    ), env);

    expect(response.status).toBe(401);
  });

  it("deletes user-scoped objects from the internal delete endpoint", async () => {
    const env = testEnv();
    env.MEDIA_BUCKET.setObject("users/user_1/media/tmp/asset_1/input.png", "input");
    env.MEDIA_BUCKET.setObject(
      "users/user_1/media/outputs/job_1/asset_1/attempts/attempt_1/output.mp4",
      "output",
    );

    const response = await mediaWorker.fetch(new Request(
      "https://media.example.test/internal/delete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-woven-media-worker-secret": "worker-secret",
        },
        body: JSON.stringify({
          keys: [
            "users/user_1/media/tmp/asset_1/input.png",
            "users/user_1/media/outputs/job_1/asset_1/attempts/attempt_1/output.mp4",
          ],
        }),
      },
    ), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted_count: 2 });
    expect(env.MEDIA_BUCKET.deletes).toEqual([
      "users/user_1/media/tmp/asset_1/input.png",
      "users/user_1/media/outputs/job_1/asset_1/attempts/attempt_1/output.mp4",
    ]);
    expect(env.MEDIA_BUCKET.objects.size).toBe(0);
  });

  it("rejects internal delete requests without the shared secret", async () => {
    const env = testEnv();

    const response = await mediaWorker.fetch(new Request(
      "https://media.example.test/internal/delete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-woven-media-worker-secret": "wrong",
        },
        body: JSON.stringify({ keys: ["users/user_1/media/tmp/asset_1/input.png"] }),
      },
    ), env);

    expect(response.status).toBe(401);
    expect(env.MEDIA_BUCKET.deletes).toEqual([]);
  });

  it("rejects internal delete requests for non-user keys", async () => {
    const env = testEnv();
    env.MEDIA_BUCKET.setObject("woven-hero-v4.mp4", "hero");

    const response = await mediaWorker.fetch(new Request(
      "https://media.example.test/internal/delete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-woven-media-worker-secret": "worker-secret",
        },
        body: JSON.stringify({ keys: ["woven-hero-v4.mp4"] }),
      },
    ), env);

    expect(response.status).toBe(400);
    expect(env.MEDIA_BUCKET.deletes).toEqual([]);
    expect(env.MEDIA_BUCKET.objects.has("woven-hero-v4.mp4")).toBe(true);
  });

  it("rejects internal delete requests for non-media user keys", async () => {
    const env = testEnv();

    for (const key of [
      "users/user_1/profile/avatar.png",
      "users/user_1/media/outputs/job_1/out_1.mp4",
    ]) {
      const response = await mediaWorker.fetch(new Request(
        "https://media.example.test/internal/delete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-woven-media-worker-secret": "worker-secret",
          },
          body: JSON.stringify({ keys: [key] }),
        },
      ), env);

      expect(response.status).toBe(400);
    }

    expect(env.MEDIA_BUCKET.deletes).toEqual([]);
  });

  it("rejects internal delete requests with suspicious key segments", async () => {
    const env = testEnv();

    for (const key of [
      "users//media/tmp/asset_1/input.png",
      "users/user_1/media/tmp/../input.png",
      "users/user_1/media/tmp/asset 1/input.png",
      "users/user_1/media/tmp/asset_1/nested/input.png",
      "users/user_1/media/tmp/asset_1/preview.png",
      `users/user_1/media/tmp/asset_1/${"a".repeat(500)}.png`,
    ]) {
      const response = await mediaWorker.fetch(new Request(
        "https://media.example.test/internal/delete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-woven-media-worker-secret": "worker-secret",
          },
          body: JSON.stringify({ keys: [key] }),
        },
      ), env);

      expect(response.status).toBe(400);
    }

    expect(env.MEDIA_BUCKET.deletes).toEqual([]);
  });

  it("rejects internal delete requests with more than 1000 keys", async () => {
    const env = testEnv();

    const response = await mediaWorker.fetch(new Request(
      "https://media.example.test/internal/delete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-woven-media-worker-secret": "worker-secret",
        },
        body: JSON.stringify({
          keys: Array.from({ length: 1001 }, (_, index) => `users/user_1/media/${index}.png`),
        }),
      },
    ), env);

    expect(response.status).toBe(400);
    expect(env.MEDIA_BUCKET.deletes).toEqual([]);
  });

  it("rejects tampered tokens", async () => {
    const env = testEnv();
    const token = await signMediaToken({
      kind: "download",
      sub: "user_1",
      key: "users/user_1/media/outputs/job_1/out_1.mp4",
      exp: futureExp(),
    }, "token-secret");

    const response = await mediaWorker.fetch(new Request(
      `https://media.example.test/objects/out_1?token=${token}x`,
    ), env);

    expect(response.status).toBe(401);
  });
});

function testEnv(options: {
  maxUploadBytes?: string;
  uploadCompletionMode?: string;
} = {}): WorkerEnv {
  return {
    MEDIA_BUCKET: new FakeBucket(),
    MEDIA_TOKEN_SECRET: "token-secret",
    MEDIA_WORKER_SHARED_SECRET: "worker-secret",
    WOVEN_API_BASE_URL: "https://app.example.test/",
    MEDIA_MAX_UPLOAD_BYTES: options.maxUploadBytes ?? "1000",
    UPLOAD_COMPLETION_MODE: options.uploadCompletionMode,
  };
}

function uploadToken(options: {
  key: string;
  sizeBytes: number;
  assetId?: string;
  contentType?: string;
  jobId?: string;
}): Promise<string> {
  return signMediaToken({
    kind: "upload",
    sub: "user_1",
    key: options.key,
    assetId: options.assetId ?? "asset_1",
    contentType: options.contentType ?? "image/png",
    sizeBytes: options.sizeBytes,
    jobId: options.jobId,
    exp: futureExp(),
  }, "token-secret");
}

function uploadRequest(
  assetId: string,
  token: string,
  options: { body: string; contentLength: string | null },
): Request {
  const headers = new Headers({ "content-type": "image/png" });
  if (options.contentLength !== null) {
    headers.set("content-length", options.contentLength);
  }

  return new Request(`https://media.example.test/uploads/${assetId}?token=${token}`, {
    method: "PUT",
    headers,
    body: options.body,
  });
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 60;
}
