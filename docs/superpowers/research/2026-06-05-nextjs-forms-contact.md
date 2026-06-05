# Research digest — Next.js 16 form handling for the contact page

Source: vendored docs in `node_modules/next/dist/docs/01-app/` (Next 16.2.3, React 19.2.4).
Read directly rather than via context7 because `AGENTS.md` warns this is a modified Next.

## Conclusion: use a Server Action invoked with `useActionState`

For a form that mutates server state, the idiomatic Next 16 pattern is a **Server Action**, not
a client `fetch` to a route handler. A route handler is only the recommended path for a public
JSON API consumed by external clients (which is what `app/api/v1/**` already is — keep that
separate). The contact form is first-party UI, so a Server Action is the better fit.

Shape:
- Form lives in a **Client Component** (needs `useActionState` for inline validation errors +
  pending state). Render it from the `/contact` Server Component page.
- Action file is `'use server'`; the action signature with `useActionState` is
  `async function submitContact(prevState, formData)` — `prevState` is the first arg.
- `useActionState(action, initialState)` returns `[state, formAction, pending]`. Bind
  `formAction` to `<form action={...}>` and use `pending` to disable the submit button
  (or a child `SubmitButton` using `useFormStatus()`).
- Extract fields with `formData.get('name' | 'email' | 'message')`.

## Security note (from the docs, important here)

> Server Functions are reachable via direct POST requests, not just through your application's UI.
> Always verify authentication/authorization and validate inside every Server Function.

This endpoint is intentionally **unauthenticated** (public contact form), so the action MUST:
- Validate every field server-side (don't trust the client).
- Carry its own spam mitigation (honeypot field + lightweight throttle) since there's no auth gate.

## Validation approach

`zod` is NOT a direct dependency (only transitive). Existing API routes
(`app/api/v1/reel-captions/jobs/route.ts`) hand-roll validation (`typeof === "string"`, length
caps, `Number.isFinite`). Follow that pattern — no new dependency. Reuse the DB-level constraints
as the source of truth (message 1–10000 chars; see the feedback table migration).

## shadcn (context7: /shadcn-ui/ui) — shadcn 4.2.0, @base-ui/react 1.3.0 (installed)

This project's `components.json` uses `style: "base-nova"` — components are the **base-ui** variant
(import from `@base-ui/react/*`), not the classic Radix shadcn. Add components with the CLI; the CLI
respects `components.json` and emits the base-nova variant.

- **Add Textarea:** `pnpm dlx shadcn@latest add textarea` (docs show `npx shadcn@latest add textarea`;
  use pnpm per repo convention). This is the only missing primitive. It generates
  `components/ui/textarea.tsx` matching the repo's `input.tsx` style.
- **Field family already present:** `components/ui/field.tsx` already exports `Field`, `FieldGroup`,
  `FieldLabel`, `FieldDescription`, `FieldError`, `FieldContent`, `FieldTitle`, `FieldSeparator`,
  `FieldSet`, `FieldLegend`. No need to add anything for form layout.
- **Canonical form-without-RHF pattern** (shadcn v4 "Basic Form Anatomy", server-action driven —
  exactly our case): plain `<form action={formAction}>` + hand-managed `formState.errors`:
  ```tsx
  <form action={formAction}>
    <FieldGroup>
      <Field data-invalid={!!state.errors?.email}>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <Input id="email" name="email" type="email"
          defaultValue={state.values?.email} disabled={pending}
          aria-invalid={!!state.errors?.email} autoComplete="email" />
        {state.errors?.email && <FieldError>{state.errors.email[0]}</FieldError>}
      </Field>
      {/* name -> Input, message -> Textarea (className="min-h-[140px]") */}
    </FieldGroup>
    <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send"}</Button>
  </form>
  ```
  Errors map: `<Field data-invalid>` + matching `aria-invalid` on the control + `<FieldError>` text.
  `state` is the `useActionState` result; echo back `state.values` as `defaultValue` so a failed
  submit doesn't wipe the form.

## Misc

- `refresh()` now comes from `next/cache` (not `router.refresh()`), but we don't need it — the form
  shows an inline success state, no navigation/revalidation required.
- Progressive enhancement: a Server Action `<form action>` works even before JS hydrates, but the
  honeypot + `useActionState` error display are JS-dependent niceties; acceptable.
