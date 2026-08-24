import { describe, expect, it } from "vitest";

import {
  createInvoiceEventHandlers,
  invoiceSubscriptionID,
  type InvoiceShape,
} from "../../supabase/functions/stripe-webhook/invoice-handlers";

type TestSubscription = {
  id: string;
  status: "active" | "past_due";
};

function invoice(
  id: string,
  amountPaid: number,
  subscription: string | TestSubscription | null,
): InvoiceShape {
  return {
    id,
    amount_paid: amountPaid,
    parent: subscription
      ? {
        type: "subscription_details",
        subscription_details: { subscription },
      }
      : null,
  };
}

function subscription(id: string, status: TestSubscription["status"]) {
  return { id, status };
}

describe("Stripe invoice webhook orchestration", () => {
  it("synchronizes an active subscription before sending a paid notification", async () => {
    const calls: string[] = [];
    const handlers = createInvoiceEventHandlers<TestSubscription, InvoiceShape>({
      retrieveSubscription: async (id) => {
        calls.push(`retrieve:${id}`);
        return subscription(id, "active");
      },
      recordSubscription: async (sub, eventCreated) => {
        calls.push(`record:${sub.id}:${sub.status}:${eventCreated}`);
      },
      notifyPaid: async (paidInvoice) => {
        calls.push(`notify_paid:${paidInvoice.id}`);
      },
      notifyPaymentFailed: async () => {
        throw new Error("unexpected failed-payment notification");
      },
    });

    await handlers.paid(invoice("in_paid", 1200, "sub_paid"), 1777000000);

    expect(calls).toEqual([
      "retrieve:sub_paid",
      "record:sub_paid:active:1777000000",
      "notify_paid:in_paid",
    ]);
  });

  it("synchronizes a past-due subscription before sending a failure notification", async () => {
    const calls: string[] = [];
    const handlers = createInvoiceEventHandlers<TestSubscription, InvoiceShape>({
      retrieveSubscription: async (id) => {
        calls.push(`retrieve:${id}`);
        return subscription(id, "past_due");
      },
      recordSubscription: async (sub, eventCreated) => {
        calls.push(`record:${sub.id}:${sub.status}:${eventCreated}`);
      },
      notifyPaid: async () => {
        throw new Error("unexpected paid notification");
      },
      notifyPaymentFailed: async (failedInvoice) => {
        calls.push(`notify_failed:${failedInvoice.id}`);
      },
    });

    await handlers.paymentFailed(
      invoice("in_failed", 0, "sub_failed"),
      1777000000,
    );

    expect(calls).toEqual([
      "retrieve:sub_failed",
      "record:sub_failed:past_due:1777000000",
      "notify_failed:in_failed",
    ]);
  });

  it("synchronizes a zero-dollar paid subscription invoice without notifying", async () => {
    const calls: string[] = [];
    const handlers = createInvoiceEventHandlers<TestSubscription, InvoiceShape>({
      retrieveSubscription: async (id) => {
        calls.push(`retrieve:${id}`);
        return subscription(id, "active");
      },
      recordSubscription: async (sub, eventCreated) => {
        calls.push(`record:${sub.id}:${sub.status}:${eventCreated}`);
      },
      notifyPaid: async () => {
        calls.push("notify_paid");
      },
      notifyPaymentFailed: async () => {
        throw new Error("unexpected failed-payment notification");
      },
    });

    await handlers.paid(invoice("in_zero", 0, "sub_zero"), 1777000000);

    expect(calls).toEqual([
      "retrieve:sub_zero",
      "record:sub_zero:active:1777000000",
    ]);
  });

  it("notifies for a non-subscription invoice without synchronizing", async () => {
    const calls: string[] = [];
    const handlers = createInvoiceEventHandlers<TestSubscription, InvoiceShape>({
      retrieveSubscription: async (id) => {
        calls.push(`retrieve:${id}`);
        return subscription(id, "active");
      },
      recordSubscription: async (sub) => {
        calls.push(`record:${sub.id}`);
      },
      notifyPaid: async (paidInvoice) => {
        calls.push(`notify_paid:${paidInvoice.id}`);
      },
      notifyPaymentFailed: async () => {
        throw new Error("unexpected failed-payment notification");
      },
    });

    await handlers.paid(invoice("in_standalone", 500, null), 1777000000);

    expect(calls).toEqual(["notify_paid:in_standalone"]);
  });

  it("extracts an expanded subscription reference", async () => {
    const expanded = subscription("sub_expanded", "active");

    expect(invoiceSubscriptionID(invoice("in_expanded", 500, expanded))).toBe(
      "sub_expanded",
    );
  });

  it("rejects without notifying when subscription retrieval fails", async () => {
    const calls: string[] = [];
    const handlers = createInvoiceEventHandlers<TestSubscription, InvoiceShape>({
      retrieveSubscription: async (id) => {
        calls.push(`retrieve:${id}`);
        throw new Error("Stripe unavailable");
      },
      recordSubscription: async (sub) => {
        calls.push(`record:${sub.id}`);
      },
      notifyPaid: async (paidInvoice) => {
        calls.push(`notify_paid:${paidInvoice.id}`);
      },
      notifyPaymentFailed: async () => {
        throw new Error("unexpected failed-payment notification");
      },
    });

    await expect(
      handlers.paid(invoice("in_retry", 500, "sub_retry"), 1777000000),
    ).rejects.toThrow("Stripe unavailable");
    expect(calls).toEqual(["retrieve:sub_retry"]);
  });
});
