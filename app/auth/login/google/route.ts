import { NextRequest, NextResponse } from "next/server";

import { safeNextPath, searchParamUrl } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const redirectTo = new URL("/auth/callback", requestUrl.origin);

  redirectTo.searchParams.set("next", next);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo.toString(),
    },
  });

  if (error || !data.url) {
    console.error("Google sign-in failed", error);

    return NextResponse.redirect(
      new URL(
        searchParamUrl("/login", {
          next,
          error: error?.message ?? "Unable to start Google sign-in.",
        }),
        requestUrl.origin,
      ),
    );
  }

  return NextResponse.redirect(data.url);
}
