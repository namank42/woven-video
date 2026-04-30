import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getOptionalSupabaseEnv } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const env = getOptionalSupabaseEnv();

  if (!env) {
    return response;
  }

  // Anonymous visitors have no Supabase auth cookie. Without a session to
  // refresh, getUser() is a wasted round-trip to Supabase on every nav.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-"));

  if (!hasAuthCookie) {
    return response;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  await supabase.auth.getUser();

  // Prevent CDNs from caching responses that may carry session cookies.
  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

// Marketing routes (/, /pricing, etc.) are static and handle auth state
// client-side. Only run the proxy on routes that gate access or refresh
// sessions.
export const config = {
  matcher: ["/account/:path*", "/auth/:path*", "/login", "/api/:path*"],
};
