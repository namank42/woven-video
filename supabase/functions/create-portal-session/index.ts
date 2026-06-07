import Stripe from "stripe";

import {
  errorResponse,
  HttpError,
  jsonResponse,
  optionsResponse,
  requiredEnv,
} from "../_shared/http.ts";
import {
  createServiceClient,
  requireAuthenticatedUser,
} from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const user = await requireAuthenticatedUser(req);
    const admin = createServiceClient();
    const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-04-22.dahlia",
    });
    const siteUrl = Deno.env.get("WOVEN_SITE_URL") ?? "http://localhost:3000";

    const { data: profile, error } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (error) {
      throw new HttpError(500, "failed_to_load_profile", error);
    }
    if (!profile.stripe_customer_id) {
      throw new HttpError(400, "no_stripe_customer");
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl}/account`,
    });

    return jsonResponse({ url: portal.url });
  } catch (error) {
    return errorResponse(error);
  }
});
