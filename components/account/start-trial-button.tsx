"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function StartTrialButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="h-10 rounded-lg px-5">
      {pending ? "Opening Stripe…" : "Start your 7-day free trial"}
    </Button>
  );
}
