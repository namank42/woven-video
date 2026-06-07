"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function ResumeSubscriptionButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="h-9 rounded-lg px-4">
      {pending ? "Resuming…" : "Resume subscription"}
    </Button>
  );
}
