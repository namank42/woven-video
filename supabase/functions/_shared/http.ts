export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("WOVEN_ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function optionsResponse(): Response {
  return new Response("ok", {
    status: 200,
    headers: corsHeaders,
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      {
        error: error.message,
        details: error.details,
      },
      error.status,
    );
  }

  console.error(error);

  return jsonResponse(
    {
      error: "internal_server_error",
    },
    500,
  );
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new HttpError(500, `missing_env_${name.toLowerCase()}`);
  }

  return value;
}
