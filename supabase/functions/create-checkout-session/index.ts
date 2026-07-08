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
import {
  buildSubscriptionCheckoutSession,
  normalizeCheckoutOrigin,
} from "./subscription.ts";

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

    // ---- SUBSCRIPTION checkout (trial -> $99/yr, or immediate paid after trial used) ----
    if (body.purpose === "subscription") {
      const { data: hasAccess, error: accessError } = await admin.rpc(
        "user_has_access",
        { p_user_id: user.id },
      );

      if (accessError) {
        throw new HttpError(500, "failed_to_check_access", accessError);
      }

      if (hasAccess) {
        return jsonResponse({ alreadySubscribed: true, checkoutMode: "none" });
      }

      const { data: trialUsed, error: trialUsedError } = await admin.rpc(
        "user_trial_used",
        { p_user_id: user.id },
      );

      if (trialUsedError) {
        throw new HttpError(
          500,
          "failed_to_check_trial_eligibility",
          trialUsedError,
        );
      }

      const checkoutPlan = buildSubscriptionCheckoutSession({
        customerId,
        userId: user.id,
        priceId: requiredEnv("STRIPE_SUBSCRIPTION_PRICE_ID"),
        siteUrl,
        origin: normalizeCheckoutOrigin(body.origin),
        trialUsed: trialUsed === true,
      });

      const subscriptionSession = await stripe.checkout.sessions.create(
        checkoutPlan.params,
      );

      return jsonResponse({
        url: subscriptionSession.url,
        checkoutMode: checkoutPlan.checkoutMode,
      });
    }

    // ---- LICENSE checkout ----
    if (body.purpose === "license") {
      const { data: alreadyLicensed, error: existingError } = await admin.rpc(
        "user_has_active_license",
        { p_user_id: user.id },
      );

      if (existingError) {
        throw new HttpError(500, "failed_to_check_license", existingError);
      }

      if (alreadyLicensed) {
        return jsonResponse({ alreadyLicensed: true });
      }

      const licenseMetadata = { user_id: user.id, purpose: "license" };

      // Whitelisted redirect target. App buyers are authenticated in the app but
      // usually NOT in this browser, so /account would bounce them to /login —
      // route them to the public confirmation pages instead. Any value other
      // than "app" (including absent) keeps the original web behavior. Never echo
      // a client-supplied raw URL (open-redirect).
      const origin = body.origin === "app" ? "app" : "web";
      const successUrl = origin === "app"
        ? `${siteUrl}/checkout/success`
        : `${siteUrl}/account?license=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = origin === "app"
        ? `${siteUrl}/checkout/cancelled`
        : `${siteUrl}/account?license=cancelled`;

      const licenseSession = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        client_reference_id: user.id,
        payment_method_types: ["card"],
        line_items: [
          { price: requiredEnv("STRIPE_LICENSE_PRICE_ID"), quantity: 1 },
        ],
        metadata: licenseMetadata,
        payment_intent_data: { metadata: licenseMetadata },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return jsonResponse({ url: licenseSession.url });
    }

    // ---- TOPUP checkout ----
    const topUp = getTopUpFromBody(body);

    if (
      !topUp ||
      topUp.amountCents < MIN_TOP_UP_CENTS ||
      topUp.amountCents > MAX_TOP_UP_CENTS
    ) {
      throw new HttpError(400, "invalid_top_up_amount");
    }

    // No credit purchase without a license. Same flag as the hosted-route gate, so
    // this is a no-op until enforcement is turned on. Grandfather eligibility is
    // derived (created_at < cutoff), so pre-cutoff users pass without a license row.
    if (Deno.env.get("WOVEN_ENFORCE_LICENSE") === "true") {
      const { data: licensed, error: licenseCheckError } = await admin.rpc(
        "user_has_access",
        { p_user_id: user.id },
      );

      if (licenseCheckError) {
        throw new HttpError(500, "failed_to_check_license", licenseCheckError);
      }

      if (!licensed) {
        throw new HttpError(403, "license_required");
      }
    }

    const metadata = {
      user_id: user.id,
      purpose: "topup",
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
