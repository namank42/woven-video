import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getOptionalSupabaseEnv } from "@/lib/supabase/env";

import { docsMarkdown, homeMarkdown } from "@/lib/agent-readiness/content";
import { markdownResponse, preferredDocumentType } from "@/lib/agent-readiness/http";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/" || path === "/docs") {
    const next = NextResponse.next();
    // Next 16.2 overwrites HTML Vary during page rendering. Prevent shared
    // caching explicitly; Markdown responses retain their own Vary header.
    next.headers.set("Vary", "Accept, Accept-Encoding");
    next.headers.set("Cache-Control", "private, no-store");
    next.headers.set("CDN-Cache-Control", "no-store");
    next.headers.set("Vercel-CDN-Cache-Control", "no-store");
    next.headers.set("Link", `</llms.txt>; rel="describedby", <${path === "/" ? "/index.md" : "/docs/index.md"}>; rel="alternate"; type="text/markdown"`);
    if (!["GET", "HEAD"].includes(request.method) || request.headers.get("rsc") === "1") return next;
    const type = preferredDocumentType(request.headers.get("accept"));
    if (!type) return new Response(null, { status: 406, headers: { Vary: "Accept, Accept-Encoding", "Cache-Control": "private, no-store" } });
    if (type.startsWith("text/markdown")) return markdownResponse(path === "/" ? homeMarkdown : docsMarkdown, request);
    return next;
  }
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

// Negotiate the two public documents; other entries preserve auth refresh.
export const config = {
  matcher: ["/", "/docs", "/account/:path*", "/auth/:path*", "/login", "/api/:path*"],
};
