"use client";

import { useActionState } from "react";

import { submitContact, type ContactState } from "@/app/contact/actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const initialState: ContactState = { status: "idle" };

export function ContactForm({ prefillEmail }: { prefillEmail?: string }) {
  const [state, formAction, pending] = useActionState(
    submitContact,
    initialState,
  );

  if (state.status === "success") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Thanks — message sent.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll get back to you{state.email ? ` at ${state.email}` : ""} soon.
        </p>
      </div>
    );
  }

  const errors = state.status === "error" ? state.errors : {};
  const values = state.status === "error" ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {errors._form ? (
        <p className="text-sm text-destructive" role="alert">
          {errors._form[0]}
        </p>
      ) : null}

      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            name="name"
            defaultValue={values?.name}
            disabled={pending}
            autoComplete="name"
            aria-invalid={!!errors.name}
          />
          {errors.name ? <FieldError>{errors.name[0]}</FieldError> : null}
        </Field>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={values?.email ?? prefillEmail}
            disabled={pending}
            autoComplete="email"
            aria-invalid={!!errors.email}
          />
          {errors.email ? <FieldError>{errors.email[0]}</FieldError> : null}
        </Field>

        <Field data-invalid={!!errors.message}>
          <FieldLabel htmlFor="message">Message</FieldLabel>
          <Textarea
            id="message"
            name="message"
            required
            rows={6}
            className="min-h-[140px]"
            defaultValue={values?.message}
            disabled={pending}
            aria-invalid={!!errors.message}
          />
          {errors.message ? (
            <FieldError>{errors.message[0]}</FieldError>
          ) : (
            <FieldDescription>
              For a refund within your 7-day window, include your account email.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      {/* Honeypot: off-screen, hidden from humans and assistive tech, tempting to bots. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
        <label htmlFor="company">Company</label>
        <input
          id="company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
