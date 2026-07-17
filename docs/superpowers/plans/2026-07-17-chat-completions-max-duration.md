# Hosted Chat Maximum Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Woven hosted chat proxy to keep Kimi K3 and other streamed model requests open for up to 800 seconds instead of inheriting Vercel's 300-second default.

**Architecture:** Add Next.js's route-level `maxDuration` export to the existing App Router chat-completions route so only that Vercel Function receives the longer ceiling. Encode the value in the existing route contract test, then verify the deployed function metadata; do not change the project-wide Vercel default or add model/runtime limits to the Harness in this plan.

**Tech Stack:** Next.js 16.2.3 App Router, TypeScript, Vitest, Vercel Functions with Fluid Compute

**Docs digest:** [`docs/superpowers/research/2026-07-17-chat-completions-max-duration-docs.md`](../research/2026-07-17-chat-completions-max-duration-docs.md)

## Global Constraints

- Configure exactly `800` seconds on `/api/v1/chat/completions` only.
- Keep `runtime = "nodejs"` and `dynamic = "force-dynamic"` unchanged.
- Do not change the Vercel project-wide default, `vercel.json`, AI Gateway retry behavior, provider selection, output-token limits, or Harness behavior.
- Treat this as protection against a latent 300-second Vercel cutoff. It does not fix Moonshot 503 responses; those are upstream provider failures and remain separate.
- Do not run an intentionally 800-second production generation. Verify the static route contract and deployed function metadata instead.
- Use `pnpm` for JavaScript and TypeScript verification.
- Implement on a focused branch from current `origin/main`; keep local `main` clean.

---

### Task 1: Add and test the route-specific duration ceiling

**Files:**
- Modify: `tests/chat-completions-model-policy.test.ts`
- Modify: `app/api/v1/chat/completions/route.ts:16-18`

**Interfaces:**
- Consumes: Next.js App Router's statically analyzable `export const maxDuration: number` route-segment configuration.
- Produces: `maxDuration = 800` in the chat-completions route's build output for Vercel to enforce.

- [ ] **Step 1: Write the failing route configuration test**

In `tests/chat-completions-model-policy.test.ts`, replace the route import:

```ts
import { POST } from "@/app/api/v1/chat/completions/route";
```

with:

```ts
import {
  maxDuration,
  POST,
} from "@/app/api/v1/chat/completions/route";
```

Then add this test as the first test inside `describe("hosted chat model policy", ...)`:

```ts
it("allows hosted chat streams to run up to Vercel's Pro limit", () => {
  expect(maxDuration).toBe(800);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run tests/chat-completions-model-policy.test.ts
```

Expected: FAIL because the route does not export `maxDuration`, either as a missing named export or an `undefined` value that does not equal `800`.

- [ ] **Step 3: Add the minimal route implementation**

In `app/api/v1/chat/completions/route.ts`, keep the existing segment configuration and add the literal duration export:

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;
```

Do not place the value in a helper, environment variable, or computed expression; Next.js and Vercel must be able to read it from the route's build output.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/chat-completions-model-policy.test.ts
```

Expected: PASS with all three tests passing, including the new exact `800` assertion.

- [ ] **Step 5: Run the repository verification gates**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all tests pass, ESLint reports no errors, and the Next.js production build completes successfully.

- [ ] **Step 6: Review scope and commit the implementation**

Run:

```bash
git diff --check
git diff -- app/api/v1/chat/completions/route.ts tests/chat-completions-model-policy.test.ts
git status --short
```

Expected: no whitespace errors; the implementation diff contains only the new `maxDuration` export and its contract test. The plan and docs digest may also appear if they were not committed separately.

Commit:

```bash
git add app/api/v1/chat/completions/route.ts tests/chat-completions-model-policy.test.ts docs/superpowers/plans/2026-07-17-chat-completions-max-duration.md docs/superpowers/research/2026-07-17-chat-completions-max-duration-docs.md
git commit -m "fix(api): extend hosted chat stream duration"
```

---

### Task 2: Deploy and verify the route configuration

**Files:**
- Modify: none

**Interfaces:**
- Consumes: the verified implementation commit from Task 1.
- Produces: a Git-connected Vercel production deployment whose chat-completions function reports an 800-second maximum duration.

- [ ] **Step 1: Push the focused branch and open the pull request**

Use the execution branch `fix/chat-completions-max-duration`:

```bash
git push -u origin fix/chat-completions-max-duration
gh pr create \
  --base main \
  --head fix/chat-completions-max-duration \
  --title "fix(api): extend hosted chat stream duration" \
  --body "Set the hosted chat-completions Vercel Function to the Pro/Fluid 800-second maximum. This is route-scoped and does not change Harness generation limits or upstream provider retries."
```

Expected: GitHub returns the new PR URL.

- [ ] **Step 2: Require CI to pass before merge**

Run:

```bash
PR_NUMBER="$(gh pr view --json number --jq .number)"
gh pr checks "$PR_NUMBER" --watch
```

Expected: every required check finishes successfully. Stop on any failure.

- [ ] **Step 3: Merge and capture the production commit**

Run:

```bash
gh pr merge "$PR_NUMBER" --squash --delete-branch
MERGE_SHA="$(gh pr view "$PR_NUMBER" --json mergeCommit --jq .mergeCommit.oid)"
printf '%s\n' "$MERGE_SHA"
```

Expected: PR state is `MERGED` and `MERGE_SHA` is non-empty. Merging to `main` triggers the Git-connected Vercel production deployment.

- [ ] **Step 4: Wait for the Vercel production deployment**

Run:

```bash
gh api "repos/namank42/woven-video/commits/$MERGE_SHA/status" \
  --jq '{state, deployments: [.statuses[] | select(.context == "Vercel") | {state, target_url, description}]}'
```

Poll until the overall state and Vercel status are `success`. Stop if the deployment fails.

- [ ] **Step 5: Verify the deployed function metadata**

Open the successful production deployment from the Vercel status target, select its Functions view, and open the function for `app/api/v1/chat/completions/route`.

Expected:

- runtime is Node.js;
- maximum duration is `800s`;
- the production deployment commit matches `MERGE_SHA`.

Do not change the dashboard's project-wide **Default Max Duration** field; the route export is the source of truth for this function.

- [ ] **Step 6: Run a short authenticated production smoke**

With the release-owner smoke token already exported as `WOVEN_PROD_SMOKE_BEARER_TOKEN`, run:

```bash
curl -sS \
  -H "Authorization: Bearer $WOVEN_PROD_SMOKE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k3","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":32,"stream":false}' \
  https://www.woven.video/api/v1/chat/completions \
  | jq -e '.choices | length > 0'
```

Expected: the request succeeds and `jq` returns `true`. Unset the token afterward:

```bash
unset WOVEN_PROD_SMOKE_BEARER_TOKEN
```

This smoke proves that the deployed route still proxies and settles a normal request; the metadata inspection in Step 5 proves the 800-second ceiling without paying for an intentionally long generation.

- [ ] **Step 7: Record the diagnostic boundary**

Record the PR URL, `MERGE_SHA`, production deployment URL, function metadata showing `800s`, and smoke result.

For future incidents:

- HTTP 504 with `FUNCTION_INVOCATION_TIMEOUT` indicates the Vercel duration ceiling;
- HTTP 503 from Moonshot or AI Gateway remains an upstream availability failure and is not fixed by this change;
- Harness step/output limits, retries, and provider fallback remain a separate release path.

## Completion criteria

- `app/api/v1/chat/completions/route.ts` exports the literal `maxDuration = 800`.
- The focused contract test and full repository gates pass.
- No project-wide Vercel duration setting or Harness configuration changes.
- The production function metadata reports an 800-second maximum duration.
- A short authenticated Kimi K3 request still completes after deployment.
