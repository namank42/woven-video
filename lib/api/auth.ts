import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { unauthorizedError } from "@/lib/api/responses";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type ApiAuth = {
  authorization: string;
  supabase: SupabaseClient;
  user: User;
};

type ApiAuthResult =
  | {
      ok: true;
      auth: ApiAuth;
    }
  | {
      ok: false;
      response: Response;
    };

export async function requireApiAuth(request: Request): Promise<ApiAuthResult> {
  const authorization = request.headers.get("authorization");

  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: unauthorizedError(),
    };
  }

  const { url, anonKey } = getSupabaseEnv();
  const supabase = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      ok: false,
      response: unauthorizedError("Invalid or expired bearer token."),
    };
  }

  return {
    ok: true,
    auth: {
      authorization,
      supabase,
      user: data.user,
    },
  };
}
