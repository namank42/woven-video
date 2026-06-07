"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchParamUrl } from "@/lib/navigation";

const MIN_TOP_UP_CENTS = 500;
const MAX_TOP_UP_CENTS = 10000;

function dollarsToCents(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }

  const [dollars, cents = ""] = value.trim().split(".");

  return Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
}

function parseTopUpAmountCents(formData: FormData) {
  const topUpChoice = formData.get("topUpChoice");

  if (topUpChoice === "custom") {
    return dollarsToCents(formData.get("customAmountUsd"));
  }

  const amountCents = formData.get("amountCents");

  if (typeof amountCents !== "string" || !/^\d+$/.test(amountCents)) {
    return null;
  }

  return Number(amountCents);
}

function isValidTopUpAmount(amountCents: number | null): amountCents is number {
  return (
    amountCents !== null &&
    Number.isInteger(amountCents) &&
    amountCents >= MIN_TOP_UP_CENTS &&
    amountCents <= MAX_TOP_UP_CENTS
  );
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function createCheckoutSession(formData: FormData) {
  const amountCents = parseTopUpAmountCents(formData);

  if (!isValidTopUpAmount(amountCents)) {
    redirect(
      searchParamUrl("/account", {
        error: "Choose a top-up amount between $5 and $100.",
      }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/login?next=/account");
  }

  const { url, anonKey } = getSupabaseEnv();
  let checkoutUrl: string | undefined;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(`${url}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amountCents }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
      msg?: string;
      message?: string;
    };

    if (!response.ok) {
      errorMessage =
        payload.error ??
        payload.msg ??
        payload.message ??
        `Unable to create checkout session. (${response.status})`;
    } else {
      checkoutUrl = payload.url;
    }
  } catch {
    errorMessage =
      "Checkout function is not reachable. Start Supabase Functions locally before testing top-ups.";
  }

  if (!checkoutUrl) {
    redirect(
      searchParamUrl("/account", {
        error: errorMessage,
      }),
    );
  }

  redirect(checkoutUrl);
}

export async function createTrialCheckoutSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/login?next=/account");
  }

  const { url, anonKey } = getSupabaseEnv();
  let checkoutUrl: string | undefined;
  let errorMessage: string | undefined;
  let alreadySubscribed = false;

  try {
    const response = await fetch(`${url}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ purpose: "subscription" }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      alreadySubscribed?: boolean;
      error?: string;
      msg?: string;
      message?: string;
    };

    if (payload.alreadySubscribed) {
      alreadySubscribed = true;
    } else if (!response.ok) {
      errorMessage =
        payload.error ??
        payload.msg ??
        payload.message ??
        `Unable to start your free trial. (${response.status})`;
    } else {
      checkoutUrl = payload.url;
    }
  } catch {
    errorMessage = "Checkout function is not reachable.";
  }

  if (alreadySubscribed) {
    redirect(searchParamUrl("/account", { subscription: "already" }));
  }

  if (!checkoutUrl) {
    redirect(searchParamUrl("/account", { error: errorMessage }));
  }

  redirect(checkoutUrl);
}

export async function createPortalSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/login?next=/account");
  }

  const { url, anonKey } = getSupabaseEnv();
  let portalUrl: string | undefined;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(`${url}/functions/v1/create-portal-session`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
      msg?: string;
      message?: string;
    };

    if (!response.ok) {
      errorMessage =
        payload.error ??
        payload.msg ??
        payload.message ??
        `Unable to open the billing portal. (${response.status})`;
    } else {
      portalUrl = payload.url;
    }
  } catch {
    errorMessage = "Billing portal is not reachable.";
  }

  if (!portalUrl) {
    redirect(searchParamUrl("/account", { error: errorMessage }));
  }

  redirect(portalUrl);
}

export async function resumeSubscription() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/account");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/login?next=/account");
  }

  const { url, anonKey } = getSupabaseEnv();
  let ok = false;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(`${url}/functions/v1/reactivate-subscription`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      msg?: string;
      message?: string;
    };

    if (!response.ok || !payload.ok) {
      errorMessage =
        payload.error ??
        payload.msg ??
        payload.message ??
        `Unable to resume your subscription. (${response.status})`;
    } else {
      ok = true;
    }
  } catch {
    errorMessage = "Reactivation service is not reachable.";
  }

  if (!ok) {
    redirect(searchParamUrl("/account", { error: errorMessage }));
  }

  revalidatePath("/account");
  redirect(searchParamUrl("/account", { subscription: "resumed" }));
}
