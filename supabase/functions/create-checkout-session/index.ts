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

const MIN_TOP_UP_CENTS = 500;
const MAX_TOP_UP_CENTS = 10000;
const USD_MICROS_PER_CENT = 10_000;

function parseAmountCents(value: unknown) {
  if (Number.isInteger(value)) {
    return value as number;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }

  return null;
}

function getTopUpFromBody(body: Record<string, unknown>) {
  const amountCents = parseAmountCents(body.amountCents);

  if (amountCents !== null) {
    return {
      amountCents,
      topUpId: `balance_${amountCents}`,
    };
  }

  return null;
}

function formatUsd(cents: number) {
  return (cents / 100).toFixed(2);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return optionsResponse();
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const user = await requireAuthenticatedUser(req);
    const body = await req.json().catch(() => ({}));
    const topUp = getTopUpFromBody(body);

    if (
      !topUp ||
      topUp.amountCents < MIN_TOP_UP_CENTS ||
      topUp.amountCents > MAX_TOP_UP_CENTS
    ) {
      throw new HttpError(400, "invalid_top_up_amount");
    }

    const admin = createServiceClient();
    const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-04-22.dahlia",
    });
    const siteUrl = Deno.env.get("WOVEN_SITE_URL") ?? "http://localhost:3000";

    const ensureResult = await admin.rpc("ensure_billing_account", {
      p_user_id: user.id,
    });

    if (ensureResult.error) {
      throw new HttpError(
        500,
        "failed_to_ensure_billing_account",
        ensureResult.error,
      );
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("email, stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      throw new HttpError(500, "failed_to_load_profile", profileError);
    }

    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email ?? user.email ?? undefined,
        metadata: {
          user_id: user.id,
        },
      });

      customerId = customer.id;

      const { error: updateError } = await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);

      if (updateError) {
        throw new HttpError(
          500,
          "failed_to_store_stripe_customer",
          updateError,
        );
      }
    }

    const metadata = {
      user_id: user.id,
      top_up_id: topUp.topUpId,
      amount_cents: String(topUp.amountCents),
      amount_usd_micros: String(topUp.amountCents * USD_MICROS_PER_CENT),
      currency: "usd",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Add $${formatUsd(topUp.amountCents)} to Woven balance`,
            },
            unit_amount: topUp.amountCents,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: {
        metadata,
      },
      success_url:
        `${siteUrl}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/account?checkout=cancelled`,
    });

    return jsonResponse({
      url: session.url,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
