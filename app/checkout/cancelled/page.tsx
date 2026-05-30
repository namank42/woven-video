import type { Metadata } from "next";

import { CheckoutResult } from "@/components/checkout/checkout-result";

export const metadata: Metadata = {
  title: "Checkout cancelled",
  robots: { index: false },
};

export default function CheckoutCancelledPage() {
  return <CheckoutResult variant="cancelled" />;
}
