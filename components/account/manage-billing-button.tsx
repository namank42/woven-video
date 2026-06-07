"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function ManageBillingButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      className="h-9 rounded-lg px-4"
    >
      {pending ? "Opening…" : "Manage billing"}
    </Button>
  );
}
