import Stripe from "stripe";

import {
  errorResponse,
  HttpError,
  jsonResponse,
  requiredEnv,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const USD_MICROS_PER_CENT = 10_000;

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
    }

    return jsonResponse({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return;
  }

  const userId = session.metadata?.user_id ?? session.client_reference_id;
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

  const customerId = typeof session.customer === "string"
    ? session.customer
    : session.customer?.id;

  const admin = createServiceClient();

  if (customerId) {
    const { error: profileError } = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId);

    if (profileError) {
      throw new HttpError(500, "failed_to_store_stripe_customer", profileError);
    }
  }

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
