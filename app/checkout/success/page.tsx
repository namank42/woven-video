import type { Metadata } from "next";

import { CheckoutResult } from "@/components/checkout/checkout-result";
import { firstSearchParam } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Purchase complete",
  robots: { index: false },
};

type CheckoutSuccessPageProps = {
  searchParams: Promise<{
    subscription?: string | string[];
  }>;
};

export default async function CheckoutSuccessPage({
  searchParams,
}: CheckoutSuccessPageProps) {
  const params = await searchParams;
  const subscription = firstSearchParam(params.subscription);

  if (subscription === "trialing") {
    return <CheckoutResult variant="trial" />;
  }

  if (subscription === "started") {
    return <CheckoutResult variant="subscription" />;
  }

  return <CheckoutResult variant="generic" />;
}
