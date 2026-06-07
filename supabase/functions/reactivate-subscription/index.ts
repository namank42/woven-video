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

// Clears a scheduled cancellation on the user's live subscription (the portal's
// "Don't cancel subscription", as a one-click action on our own account page).
// Trial cancels are scheduled via cancel_at; active cancels via cancel_at_period_end —
// we clear both. The resulting customer.subscription.updated webhook re-syncs our row.
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

    const { data: sub, error } = await admin
      .from("subscriptions")
      .select("stripe_subscription_id, cancel_at, cancel_at_period_end")
      .eq("user_id", user.id)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "failed_to_load_subscription", error);
    }
    if (!sub?.stripe_subscription_id) {
      throw new HttpError(400, "no_active_subscription");
    }

    // Stripe rejects cancel_at and cancel_at_period_end together, so clear whichever
    // scheduled the cancellation: trials cancel via cancel_at (unset with ""), active
    // subs via cancel_at_period_end (unset with false).
    await stripe.subscriptions.update(
      sub.stripe_subscription_id,
      sub.cancel_at ? { cancel_at: "" } : { cancel_at_period_end: false },
    );

    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
});
