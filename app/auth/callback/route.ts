import { after, NextRequest, NextResponse } from "next/server";

import { safeNextPath, searchParamUrl } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function notifySlackOfNewSignup(email: string | undefined) {
  const url = process.env.SLACK_WEBHOOK_URL;
  console.log("[slack-signup] notify called", { hasUrl: !!url, email });
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🎉 New signup: ${email ?? "(no email)"}` }),
    });
    const body = await res.text();
    console.log("[slack-signup] response", { status: res.status, body });
  } catch (error) {
    console.error("[slack-signup] fetch failed", error);
  }
}

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
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const user = data.user;
      const ageMs = user?.created_at
        ? Date.now() - new Date(user.created_at).getTime()
        : null;
      console.log("[slack-signup] callback", {
        userId: user?.id,
        email: user?.email,
        createdAt: user?.created_at,
        lastSignInAt: user?.last_sign_in_at,
        ageMs,
      });
      if (ageMs !== null && ageMs < 30_000) {
        after(notifySlackOfNewSignup(user!.email));
      }
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
