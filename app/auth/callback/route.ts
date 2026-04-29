import { NextRequest, NextResponse } from "next/server";

import { safeNextPath, searchParamUrl } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function getRedirectOrigin(request: NextRequest, requestUrl: URL) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";

  if (process.env.NODE_ENV !== "development" && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return requestUrl.origin;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const redirectOrigin = getRedirectOrigin(request, requestUrl);
  const code = requestUrl.searchParams.get("code");
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const providerError =
    requestUrl.searchParams.get("error_description") ??
    requestUrl.searchParams.get("error");

  if (providerError) {
    console.error("OAuth provider returned an error", providerError);
  } else if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, redirectOrigin));
    }

    console.error("Supabase auth code exchange failed", error);
  } else {
    console.error("Supabase auth callback missing code");
  }

  return NextResponse.redirect(
    new URL(
      searchParamUrl("/login", {
        next,
        error:
          providerError ??
          "Unable to confirm your session. Try signing in again.",
      }),
      redirectOrigin,
    ),
  );
}
