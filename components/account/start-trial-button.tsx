"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function StartTrialButton({
  label = "Start your 7-day free trial",
}: {
  label?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="h-10 rounded-lg px-5">
      {pending ? "Opening Stripe…" : label}
    </Button>
  );
}
