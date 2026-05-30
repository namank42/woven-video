import type { Metadata } from "next";

import { CheckoutResult } from "@/components/checkout/checkout-result";

export const metadata: Metadata = {
  title: "Purchase complete",
  robots: { index: false },
};

export default function CheckoutSuccessPage() {
  return <CheckoutResult variant="success" />;
}
