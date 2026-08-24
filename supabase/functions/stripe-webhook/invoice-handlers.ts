export type InvoiceShape = {
  id: string;
  amount_paid?: number | null;
  parent?: {
    type: string;
    subscription_details?: {
      subscription?: string | { id: string } | null;
    } | null;
  } | null;
};

export type InvoiceEventDependencies<
  Subscription extends { id: string },
  Invoice extends InvoiceShape,
> = {
  retrieveSubscription: (id: string) => Promise<Subscription>;
  recordSubscription: (
    subscription: Subscription,
    eventCreated: number,
  ) => Promise<void>;
  notifyPaid: (invoice: Invoice) => Promise<void>;
  notifyPaymentFailed: (invoice: Invoice) => Promise<void>;
};

export function invoiceSubscriptionID(invoice: InvoiceShape): string | null {
  if (invoice.parent?.type !== "subscription_details") return null;
  const subscription = invoice.parent.subscription_details?.subscription;
  if (typeof subscription === "string") return subscription;
  return subscription?.id ?? null;
}

export function createInvoiceEventHandlers<
  Subscription extends { id: string },
  Invoice extends InvoiceShape,
>(deps: InvoiceEventDependencies<Subscription, Invoice>) {
  async function synchronize(invoice: Invoice, eventCreated: number) {
    const id = invoiceSubscriptionID(invoice);
    if (!id) return;
    const subscription = await deps.retrieveSubscription(id);
    await deps.recordSubscription(subscription, eventCreated);
  }

  return {
    paid: async (invoice: Invoice, eventCreated: number) => {
      await synchronize(invoice, eventCreated);
      if ((invoice.amount_paid ?? 0) > 0) await deps.notifyPaid(invoice);
    },
    paymentFailed: async (invoice: Invoice, eventCreated: number) => {
      await synchronize(invoice, eventCreated);
      await deps.notifyPaymentFailed(invoice);
    },
  };
}
