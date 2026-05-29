import Stripe from "stripe";

import {
  errorResponse,
  HttpError,
  jsonResponse,
  requiredEnv,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const USD_MICROS_PER_CENT = 10_000;
const LICENSE_BONUS_USD_MICROS = 5_000_000; // $5 starter credits bundled with a paid license

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2026-04-22.dahlia",
    });
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      throw new HttpError(400, "missing_stripe_signature");
    }

    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      requiredEnv("STRIPE_WEBHOOK_SECRET"),
    );

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
      );
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(stripe, event.data.object as Stripe.Charge);
    }

    return jsonResponse({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
});

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
) {
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return;
  }

  const admin = createServiceClient();
  const userId = session.metadata?.user_id ?? session.client_reference_id;
  const purpose = session.metadata?.purpose ?? "topup";

  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;

  if (customerId && userId) {
    const { error: profileError } = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId);

    if (profileError) {
      throw new HttpError(500, "failed_to_store_stripe_customer", profileError);
    }
  }

  // ---- LICENSE purchase (must be handled BEFORE any amount parsing) ----
  if (purpose === "license") {
    if (!userId) {
      throw new HttpError(400, "license_session_missing_user");
    }
    // payment_intent must be a real string so the grant key == the refund-lookup key.
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : null;

    if (!paymentIntentId) {
      throw new HttpError(400, "license_session_missing_payment_intent");
    }

    const { error: licenseError } = await admin.rpc("grant_license", {
      p_user_id: userId,
      p_source: "stripe",
      p_source_id: paymentIntentId,
      p_metadata: {
        checkout_session_id: session.id,
        payment_intent_id: paymentIntentId,
        amount_cents: session.amount_total,
      },
    });

    if (licenseError) {
      throw new HttpError(500, "failed_to_grant_license", licenseError);
    }

    // Bundled $5 starter credits — idempotent on (source, source_id, kind).
    const { error: bonusError } = await admin.rpc("grant_balance", {
      p_user_id: userId,
      p_amount_usd_micros: LICENSE_BONUS_USD_MICROS,
      p_source: "license_bonus",
      p_source_id: paymentIntentId,
      p_kind: "promo",
      p_metadata: {
        reason: "license_bonus",
        payment_intent_id: paymentIntentId,
      },
    });

    if (bonusError) {
      throw new HttpError(500, "failed_to_grant_license_bonus", bonusError);
    }

    return;
  }

  // ---- TOPUP (existing behavior; legacy sessions with no purpose land here) ----
  const topUpId = session.metadata?.top_up_id ?? session.metadata?.pack_id;
  const amountCents = Number(
    session.metadata?.amount_cents ?? session.amount_total,
  );
  const amountUsdMicros = amountCents * USD_MICROS_PER_CENT;

  if (!userId || !Number.isInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, "checkout_session_missing_balance_metadata");
  }

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.id;

  const { error } = await admin.rpc("grant_balance", {
    p_user_id: userId,
    p_amount_usd_micros: amountUsdMicros,
    p_source: "stripe",
    p_source_id: paymentIntentId,
    p_kind: "purchase",
    p_metadata: {
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      top_up_id: topUpId,
      amount_cents: amountCents,
      amount_usd_micros: amountUsdMicros,
      amount_total: session.amount_total,
      currency: session.currency,
    },
  });

  if (error) {
    throw new HttpError(500, "failed_to_grant_balance", error);
  }
}

async function handleChargeRefunded(stripe: Stripe, charge: Stripe.Charge) {
  // Only a FULL refund of a LICENSE charge revokes the license. Partial refunds and
  // top-up refunds are no-ops here (no credit clawback).
  if (charge.amount_refunded !== charge.amount) {
    return;
  }

  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : null;

  if (!paymentIntentId) {
    return;
  }

  // PaymentIntent metadata carries purpose + user_id (set at checkout creation).
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (pi.metadata?.purpose !== "license") {
    return;
  }
  const userId = pi.metadata?.user_id;

  const admin = createServiceClient();
  const { error } = await admin.rpc("revoke_license", {
    p_source: "stripe",
    p_source_id: paymentIntentId,
    p_user_id: userId ?? null,
    p_reason: "refund",
    p_metadata: { charge_id: charge.id, payment_intent_id: paymentIntentId },
  });

  if (error) {
    throw new HttpError(500, "failed_to_revoke_license", error);
  }
}
