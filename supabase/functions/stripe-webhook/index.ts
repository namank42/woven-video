import Stripe from "stripe";

import {
  errorResponse,
  HttpError,
  jsonResponse,
  requiredEnv,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { sendLoopsEvent } from "../_shared/loops.ts";

const USD_MICROS_PER_CENT = 10_000;
const LICENSE_BONUS_USD_MICROS = 5_000_000; // $5 starter credits bundled with a paid license
const TRIAL_CREDIT_USD_MICROS = 5_000_000; // $5 hosted credits seeded once at trial start

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
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await handleSubscriptionEvent(event.data.object as Stripe.Subscription);
    } else if (event.type === "customer.subscription.trial_will_end") {
      await handleTrialWillEnd(event.data.object as Stripe.Subscription);
    } else if (event.type === "invoice.paid") {
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
    } else if (event.type === "invoice.payment_failed") {
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
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

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

// Resolve { userId, email } from a Stripe customer id via profiles.
async function resolveProfile(
  admin: ReturnType<typeof createServiceClient>,
  customerId: string | null,
): Promise<{ userId: string | null; email: string | null }> {
  if (!customerId) return { userId: null, email: null };
  const { data } = await admin
    .from("profiles")
    .select("id, email")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return { userId: data?.id ?? null, email: data?.email ?? null };
}

async function handleSubscriptionEvent(sub: Stripe.Subscription) {
  const admin = createServiceClient();
  const customerId = customerIdOf(sub.customer);

  // user_id is set via subscription_data.metadata at checkout; fall back to customer lookup.
  let userId: string | null = sub.metadata?.user_id ?? null;
  if (!userId) {
    userId = (await resolveProfile(admin, customerId)).userId;
  }
  if (!userId) {
    throw new HttpError(400, "subscription_missing_user");
  }

  // current_period_end may live on the subscription OR on its first item (API-version dependent).
  const item = sub.items?.data?.[0];
  const periodEndUnix = (sub as { current_period_end?: number })
    .current_period_end ??
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    null;
  const priceId = item?.price?.id ?? null;

  const { error: upsertError } = await admin
    .from("subscriptions")
    .upsert({
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      status: sub.status,
      price_id: priceId,
      trial_end: sub.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
      current_period_end: periodEndUnix
        ? new Date(periodEndUnix * 1000).toISOString()
        : null,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      metadata: { latest_event_status: sub.status },
    }, { onConflict: "stripe_subscription_id" });

  if (upsertError) {
    throw new HttpError(500, "failed_to_upsert_subscription", upsertError);
  }

  // Seed $5 hosted credits once when the trial starts. Idempotent on
  // (source, source_id, kind) = ('trial_bonus', subscription_id, 'promo'), so repeated
  // trialing webhooks are a no-op.
  if (sub.status === "trialing") {
    const { error: creditError } = await admin.rpc("grant_balance", {
      p_user_id: userId,
      p_amount_usd_micros: TRIAL_CREDIT_USD_MICROS,
      p_source: "trial_bonus",
      p_source_id: sub.id,
      p_kind: "promo",
      p_metadata: { reason: "trial_bonus", stripe_subscription_id: sub.id },
    });
    if (creditError) {
      throw new HttpError(500, "failed_to_grant_trial_credit", creditError);
    }
  }
}

async function handleTrialWillEnd(sub: Stripe.Subscription) {
  const admin = createServiceClient();
  const customerId = customerIdOf(sub.customer);
  const { userId, email } = await resolveProfile(admin, customerId);
  if (email) {
    await sendLoopsEvent({
      email,
      userId: sub.metadata?.user_id ?? userId,
      eventName: "trial_ending",
    });
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Only real charges (trial conversion + annual renewals); skip $0 trial-start invoices.
  if ((invoice.amount_paid ?? 0) <= 0) {
    return;
  }
  const admin = createServiceClient();
  const customerId = customerIdOf(invoice.customer);
  const { userId, email } = await resolveProfile(admin, customerId);
  const to = invoice.customer_email ?? email;
  if (to) {
    await sendLoopsEvent({ email: to, userId, eventName: "subscription_paid" });
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const admin = createServiceClient();
  const customerId = customerIdOf(invoice.customer);
  const { userId, email } = await resolveProfile(admin, customerId);
  const to = invoice.customer_email ?? email;
  if (to) {
    await sendLoopsEvent({ email: to, userId, eventName: "payment_failed" });
  }
}
