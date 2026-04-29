import { createClient } from "@supabase/supabase-js";

import { HttpError, requiredEnv } from "./http.ts";

export function createServiceClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function requireAuthenticatedUser(req: Request) {
  const authorization = req.headers.get("Authorization");

  if (!authorization) {
    throw new HttpError(401, "missing_authorization_header");
  }

  const client = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    },
  );

  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    throw new HttpError(401, "invalid_or_expired_token", error?.message);
  }

  return data.user;
}
