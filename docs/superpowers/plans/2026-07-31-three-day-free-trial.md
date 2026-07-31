# Three-Day Free Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change newly created Woven trials to three days, publish matching web and macOS copy, and stop cached trial access at Stripe's actual `trial_end` without reducing paid users' seven-day offline grace.

**Architecture:** `woven-video` remains authoritative for trial eligibility, Stripe Checkout, and access. Its balance response gains an optional trial-only `license.offline_access_expires_at`; Harness persists that timestamp and caps cached trial access at the earlier of the normal seven-day cache limit and the Stripe expiry. All code is prepared and verified before release, then Harness ships first, Vercel publishes the web/API contract second, and the Checkout Edge Function changes the live duration last.

**Tech Stack:** Next.js 16.2.3 App Router, TypeScript, Vitest 4, Supabase/Postgres, Supabase Edge Functions on Deno, Stripe Node 22.1.0 with API `2026-04-22.dahlia`, Swift 6, SwiftUI, XCTest, XcodeGen, Sparkle.

**Docs digest:** [`docs/superpowers/research/2026-07-31-three-day-trial-stripe-docs.md`](../research/2026-07-31-three-day-trial-stripe-docs.md)

## Global Constraints

- Only trials created after the Edge Function cutover receive three days; never update an existing Stripe Subscription.
- Keep card collection, `$99/year` conversion, `$5` trial credits, cancellation, status mapping, and trial-used eligibility unchanged.
- `license.active` remains the only access gate; `checkout_mode` remains the only authority for acquisition copy.
- Harness must explicitly say `3 days free`, `before day 3`, and `Start your 3-day free trial`.
- Remove current promises of a trial-ending email and a seven-day refund window.
- Preserve the seven-day offline cache for paid and grandfathered access.
- A supplied malformed or expired trial cache timestamp fails closed.
- Do not rewrite historical specs, plans, changelogs, old appcast entries, seven-day media retention, or unrelated timing constants.
- The dormant Loops `trial_ending` handler stays unchanged.
- Read and follow the installed Next.js docs in `node_modules/next/dist/docs/` before changing App Router code. The relevant Next 16.2.3 Route Handler and `page.tsx` guides were reviewed while writing this plan.
- Work in isolated branches/worktrees at execution time. Base the Harness worktree on `origin/main`, not local `main`, because local Harness `main` currently contains two unrelated commits and an untracked `.pnpm-store/`.
- Use `feat/three-day-trial-harness` for Harness and `feat/three-day-trial` for `woven-video`.

---

## File Structure

### `woven-harness`

- Modify `Sources/WovenHarness/WovenBackendClient.swift`
  - Decode and persist the optional backend expiry on `WovenLicense`.
- Modify `Sources/WovenHarness/Stores/LicenseGate.swift`
  - Parse the ISO-8601 expiry and cap fresh active caches at that timestamp.
- Modify `Sources/WovenHarness/Models/AcquisitionPresentation.swift`
  - Own the exact three-day trial presentation.
- Modify `Sources/WovenHarness/Views/FeedbackSheet.swift`
  - Remove the stale refund-window promise.
- Modify `Tests/WovenHarnessTests/BalanceDecodingTests.swift`
  - Cover additive expiry decoding and old response compatibility.
- Modify `Tests/WovenHarnessTests/LicenseGateTests.swift`
  - Cover expiry boundaries, malformed values, and legacy cached JSON.
- Modify `Tests/WovenHarnessTests/AcquisitionPresentationTests.swift`
  - Lock the exact three-day copy and absence of the email promise.
- Modify `Tests/WovenHarnessTests/BillingAcquisitionSourceTests.swift`
  - Guard the centralized presentation and stale refund-copy removal.
- Modify `project.yml`, `CHANGELOG.md`, and `scripts/appcast.xml`
  - Release the patch as `v0.1.64`.

### `woven-video`

- Create `lib/billing/offline-access-expiry.ts`
  - Purely resolve a trial-only offline expiry from known access sources.
- Create `tests/billing/offline-access-expiry.test.ts`
  - Unit-test access-source precedence and invalid trial data.
- Modify `app/api/v1/billing/balance/route.ts`
  - Query the authenticated user's perpetual/live subscription sources and add the optional expiry.
- Modify `tests/billing/balance-route-source.test.ts`
  - Guard the additive balance contract and source-resolution calls.
- Modify `supabase/functions/create-checkout-session/subscription.ts`
  - Set new trial Checkout Sessions to three days.
- Modify `tests/billing/subscription-checkout.test.ts`
  - Lock the three-day Stripe request and unchanged trial-used behavior.
- Modify `components/account/subscription-offer.ts`
  - Publish three-day account offer copy without an email promise.
- Modify `tests/billing/subscription-offer.test.ts`
  - Lock that presentation.
- Modify `components/checkout/checkout-result.tsx`
  - Publish three-day app-return copy.
- Modify `tests/billing/checkout-result.test.ts`
  - Lock the full trial-success body.
- Create `tests/billing/trial-copy-source.test.ts`
  - Scan current production surfaces for stale trial, email, and refund promises.
- Modify current copy in:
  - `app/page.tsx`
  - `app/pricing/page.tsx`
  - `app/terms/page.tsx`
  - `app/account/page.tsx`
  - `components/marketing/page-sections.tsx`
  - `components/account/start-trial-button.tsx`
  - `components/contact/contact-form.tsx`
  - `lib/seo/constants.ts`
  - `lib/seo/faqs.ts`
  - `lib/seo/hubs.ts`
  - `lib/seo/landing-pages.ts`
  - `lib/seo/schema.ts`

---

### Task 1: Decode and Enforce Trial Offline Expiry in Harness

**Repository:** `/Users/naman/projects/woven-harness`

**Files:**

- Modify: `Tests/WovenHarnessTests/BalanceDecodingTests.swift`
- Modify: `Tests/WovenHarnessTests/LicenseGateTests.swift`
- Modify: `Sources/WovenHarness/WovenBackendClient.swift`
- Modify: `Sources/WovenHarness/Stores/LicenseGate.swift`

**Interfaces:**

- Consumes: additive backend JSON key `license.offline_access_expires_at: string`.
- Produces: `WovenLicense.offlineAccessExpiresAt: String?`.
- Produces: `LicenseGate.decision(for:now:)` that returns `.staleLocked` at or after a valid supplied expiry and for malformed supplied expiry.
- Preserves: `LicenseGate.graceWindow == 7 * 24 * 60 * 60`.

- [ ] **Step 1: Create the isolated Harness worktree**

Use the required `superpowers:using-git-worktrees` skill, fetch current refs, and create branch `feat/three-day-trial-harness` from `origin/main`. Confirm the new worktree starts at `7725e6d`/`v0.1.63` unless `origin/main` has legitimately advanced; do not bring local commits `8529f7d`, `43ce15c`, or `.pnpm-store/` into it.

Run:

```bash
git status --short --branch
git log -3 --oneline --decorate
```

Expected: clean `feat/three-day-trial-harness` worktree based on the current remote main.

- [ ] **Step 2: Write failing balance-decoding tests**

In `BalanceDecodingTests.swift`, extend the existing access test and add the expiry case:

```swift
func testBalanceDecodesAccessLicenseWithoutOfflineExpiry() throws {
    let balance = try decode("""
    {"currency":"usd","balance_usd_micros":5000000,"balance_usd":5.0,
     "license":{"active":true,"granted_at":null}}
    """)

    XCTAssertEqual(balance.license?.active, true)
    XCTAssertNil(balance.license?.offlineAccessExpiresAt)
}

func testBalanceDecodesOfflineTrialExpiry() throws {
    let balance = try decode("""
    {"currency":"usd","balance_usd_micros":5000000,"balance_usd":5.0,
     "license":{"active":true,"granted_at":null,
                "offline_access_expires_at":"2026-08-03T10:00:00.000Z"}}
    """)

    XCTAssertEqual(
        balance.license?.offlineAccessExpiresAt,
        "2026-08-03T10:00:00.000Z"
    )
}
```

Rename the current `testBalanceDecodesAccessLicense` to the first test above so there is only one no-expiry compatibility test.

- [ ] **Step 3: Write failing LicenseGate expiry tests**

Change the helper signature in `LicenseGateTests.swift`:

```swift
private func cache(
    active: Bool,
    verifiedAt: Date,
    offlineAccessExpiresAt: String? = nil
) -> CachedLicense {
    CachedLicense(
        license: WovenLicense(
            active: active,
            grantedAt: nil,
            offlineAccessExpiresAt: offlineAccessExpiresAt
        ),
        verifiedAt: verifiedAt
    )
}

private func iso8601(_ date: Date) -> String {
    ISO8601DateFormatter().string(from: date)
}
```

Add these tests:

```swift
func testFreshTrialCacheBeforeExpiryIsLicensed() {
    let c = cache(
        active: true,
        verifiedAt: now.addingTimeInterval(-3600),
        offlineAccessExpiresAt: iso8601(now.addingTimeInterval(60))
    )

    XCTAssertEqual(LicenseGate.decision(for: c, now: now), .licensed)
}

func testFreshTrialCacheAtExpiryIsStaleLocked() {
    let c = cache(
        active: true,
        verifiedAt: now.addingTimeInterval(-3600),
        offlineAccessExpiresAt: iso8601(now)
    )

    XCTAssertEqual(LicenseGate.decision(for: c, now: now), .staleLocked)
}

func testFreshTrialCacheAfterExpiryIsStaleLocked() {
    let c = cache(
        active: true,
        verifiedAt: now.addingTimeInterval(-3600),
        offlineAccessExpiresAt: iso8601(now.addingTimeInterval(-1))
    )

    XCTAssertEqual(LicenseGate.decision(for: c, now: now), .staleLocked)
}

func testMalformedTrialExpiryIsStaleLocked() {
    let c = cache(
        active: true,
        verifiedAt: now.addingTimeInterval(-3600),
        offlineAccessExpiresAt: "not-an-iso-date"
    )

    XCTAssertEqual(LicenseGate.decision(for: c, now: now), .staleLocked)
}

func testPaidCacheWithoutExpiryKeepsSevenDayGrace() {
    let c = cache(
        active: true,
        verifiedAt: now.addingTimeInterval(-(LicenseGate.graceWindow - 1))
    )

    XCTAssertEqual(LicenseGate.decision(for: c, now: now), .licensed)
}

func testLegacyCachedLicenseJSONWithoutExpiryStillDecodes() throws {
    struct LegacyLicense: Encodable {
        let active: Bool
        let grantedAt: String?

        enum CodingKeys: String, CodingKey {
            case active
            case grantedAt = "granted_at"
        }
    }

    struct LegacyCache: Encodable {
        let license: LegacyLicense
        let verifiedAt: Date
    }

    let data = try JSONEncoder().encode(
        LegacyCache(
            license: LegacyLicense(active: true, grantedAt: nil),
            verifiedAt: now
        )
    )
    let decoded = try JSONDecoder().decode(CachedLicense.self, from: data)

    XCTAssertTrue(decoded.license.isActive)
    XCTAssertNil(decoded.license.offlineAccessExpiresAt)
}
```

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
xcodebuild -quiet -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' -derivedDataPath /private/tmp/woven-three-day-trial-dd CODE_SIGNING_ALLOWED=NO test -only-testing:WovenHarnessTests/BalanceDecodingTests -only-testing:WovenHarnessTests/LicenseGateTests
```

Expected: compile failure because `WovenLicense` has no `offlineAccessExpiresAt` member or initializer argument.

- [ ] **Step 5: Decode the additive field**

Change `WovenLicense` in `WovenBackendClient.swift` to:

```swift
struct WovenLicense: Codable, Equatable {
    let active: Bool
    let grantedAt: String?
    /// Trial-only hard bound for cached offline access. Nil for paid,
    /// grandfathered, old-server, and old-cache states.
    let offlineAccessExpiresAt: String?

    var isActive: Bool { active }

    enum CodingKeys: String, CodingKey {
        case active
        case grantedAt = "granted_at"
        case offlineAccessExpiresAt = "offline_access_expires_at"
    }
}
```

Update direct `WovenLicense(...)` initializers in tests to pass
`offlineAccessExpiresAt: nil`. Do not add this field to `CachedLicense`; it is
already persisted as part of `license`.

- [ ] **Step 6: Enforce the expiry without changing the normal grace window**

Replace `LicenseGate.decision` and add the local parser:

```swift
static func decision(for cache: CachedLicense?, now: Date) -> LicenseDecision {
    guard let cache else { return .unresolved }
    let age = now.timeIntervalSince(cache.verifiedAt)
    guard age >= 0, age <= graceWindow else { return .staleLocked }
    guard cache.license.isActive else { return .unlicensed }

    if let rawExpiry = cache.license.offlineAccessExpiresAt {
        guard let expiry = parseISO8601(rawExpiry), now < expiry else {
            return .staleLocked
        }
    }

    return .licensed
}

private static func parseISO8601(_ value: String) -> Date? {
    let standard = ISO8601DateFormatter()
    if let date = standard.date(from: value) {
        return date
    }

    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value)
}
```

Update the comment above `graceWindow` to say:

```swift
/// Seven-day last-verification grace for paid and grandfathered access.
/// Trial caches are additionally capped by the backend's Stripe trial expiry.
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 4 command again.

Expected: `BalanceDecodingTests` and `LicenseGateTests` pass.

- [ ] **Step 8: Check and commit**

Run:

```bash
git diff --check
git status --short
git add Sources/WovenHarness/WovenBackendClient.swift Sources/WovenHarness/Stores/LicenseGate.swift Tests/WovenHarnessTests/BalanceDecodingTests.swift Tests/WovenHarnessTests/LicenseGateTests.swift
git commit -m "feat(billing): cap cached trial access at expiry"
```

Expected: one focused Harness commit; no unrelated local-main files.

---

### Task 2: Update Harness Trial and Support Copy

**Repository:** Harness isolated worktree

**Files:**

- Modify: `Tests/WovenHarnessTests/AcquisitionPresentationTests.swift`
- Modify: `Tests/WovenHarnessTests/BillingAcquisitionSourceTests.swift`
- Modify: `Sources/WovenHarness/Models/AcquisitionPresentation.swift`
- Modify: `Sources/WovenHarness/Views/FeedbackSheet.swift`

**Interfaces:**

- Consumes: existing `WovenCheckoutMode.trial`.
- Produces: exact centralized three-day `AcquisitionPresentation.trial`.
- Preserves: paid-safe presentation for subscription, missing, unknown, and no-checkout states.

- [ ] **Step 1: Change tests to the approved three-day copy**

Update `testTrialModeUsesTrialCopy()`:

```swift
func testTrialModeUsesTrialCopy() {
    let presentation = AcquisitionPresentation.forCheckoutMode(.trial)

    XCTAssertEqual(presentation.paywallHeadline, "Start your free trial")
    XCTAssertEqual(presentation.paywallSubtitle, "3 days free, then $99/year. Cancel anytime.")
    XCTAssertEqual(
        presentation.paywallDetail,
        "$0 due today · cancel anytime before day 3 · card required."
    )
    XCTAssertEqual(presentation.primaryCTALabel, "Start your 3-day free trial")
    XCTAssertEqual(presentation.paywallBenefits.first, "$5 in hosted credits to start")
    XCTAssertEqual(presentation.composerNotice, "Start your free trial to send messages.")
    XCTAssertEqual(presentation.composerCTALabel, "Start free trial")
    XCTAssertFalse(presentation.paywallDetail?.localizedCaseInsensitiveContains("email") ?? true)
    XCTAssertTrue(presentation.showsAcquisitionCTA)
}
```

Add a support-copy source test to `BillingAcquisitionSourceTests.swift`:

```swift
func testSupportCopyDoesNotPromiseARefundWindow() throws {
    let source = try Self.readSourceFile(
        "Sources/WovenHarness/Views/FeedbackSheet.swift"
    )

    XCTAssertTrue(
        source.contains(
            "Questions or a purchase problem? Send us a note — we usually reply within a few hours."
        )
    )
    XCTAssertFalse(source.localizedCaseInsensitiveContains("refund within 7 days"))
}
```

In the existing paywall source test, keep the old stale-copy guard and add the
new centralized-copy guard:

```swift
XCTAssertFalse(source.contains("Start your 7-day free trial"))
XCTAssertFalse(source.contains("Start your 3-day free trial"))
```

This continues proving that `LicensePaywallView` consumes the centralized
presentation instead of hard-coding the new CTA.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
xcodebuild -quiet -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' -derivedDataPath /private/tmp/woven-three-day-trial-dd CODE_SIGNING_ALLOWED=NO test -only-testing:WovenHarnessTests/AcquisitionPresentationTests -only-testing:WovenHarnessTests/BillingAcquisitionSourceTests
```

Expected: failures showing the current seven-day/email/refund strings.

- [ ] **Step 3: Update the centralized trial presentation**

Replace only the private `trial` value in
`Sources/WovenHarness/Models/AcquisitionPresentation.swift`:

```swift
private static let trial = AcquisitionPresentation(
    paywallHeadline: "Start your free trial",
    paywallSubtitle: "3 days free, then $99/year. Cancel anytime.",
    paywallDetail: "$0 due today · cancel anytime before day 3 · card required.",
    paywallBenefits: [
        "$5 in hosted credits to start"
    ] + providerAccessBenefits,
    primaryCTALabel: "Start your 3-day free trial",
    refreshHint: "No access yet. If you just started your trial, give it a few seconds and tap Refresh again.",
    composerNotice: "Start your free trial to send messages.",
    composerCTALabel: "Start free trial"
)
```

Do not change subscription, missing/unknown, or no-checkout behavior.

- [ ] **Step 4: Remove the stale Harness refund promise**

Change `FeedbackSheet.Purpose.support.subtitle` to:

```swift
return "Questions or a purchase problem? Send us a note — we usually reply within a few hours."
```

Do not remove the support entry point or change feedback submission behavior.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: both suites pass.

- [ ] **Step 6: Check and commit**

Run:

```bash
git diff --check
git add Sources/WovenHarness/Models/AcquisitionPresentation.swift Sources/WovenHarness/Views/FeedbackSheet.swift Tests/WovenHarnessTests/AcquisitionPresentationTests.swift Tests/WovenHarnessTests/BillingAcquisitionSourceTests.swift
git commit -m "fix(billing): advertise three-day free trial"
```

Expected: second focused Harness commit.

---

### Task 3: Publish the Trial-Only Offline Expiry from `woven-video`

**Repository:** `/Users/naman/projects/woven-video`

**Files:**

- Create: `lib/billing/offline-access-expiry.ts`
- Create: `tests/billing/offline-access-expiry.test.ts`
- Modify: `app/api/v1/billing/balance/route.ts`
- Modify: `tests/billing/balance-route-source.test.ts`

**Interfaces:**

- Produces:

```ts
type OfflineAccessExpiryResolution =
  | { ok: true; expiresAt: string | null }
  | { ok: false };
```

- Produces:

```ts
resolveOfflineAccessExpiry({
  hasAccess,
  hasPerpetualAccess,
  liveSubscriptions,
}): OfflineAccessExpiryResolution
```

- Adds optional JSON field `license.offline_access_expires_at`.
- Preserves `license.active`, `license.granted_at`, `trial_used`, and `checkout_mode`.

- [ ] **Step 1: Create the isolated `woven-video` worktree**

Use `superpowers:using-git-worktrees` and create
`feat/three-day-trial` from local `main` at the commit containing the approved
design and this plan. Verify the branch contains
`docs/superpowers/specs/2026-07-31-three-day-free-trial-design.md`.

Run:

```bash
git status --short --branch
git log -3 --oneline --decorate
```

Expected: clean isolated worktree containing the approved docs.

- [ ] **Step 2: Write failing pure resolver tests**

Create `tests/billing/offline-access-expiry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveOfflineAccessExpiry } from "@/lib/billing/offline-access-expiry";

describe("resolveOfflineAccessExpiry", () => {
  const trialEnd = "2026-08-03T10:00:00.000Z";

  it("returns no bound when access is inactive", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: false,
        hasPerpetualAccess: false,
        liveSubscriptions: [],
      }),
    ).toEqual({ ok: true, expiresAt: null });
  });

  it("prefers perpetual access over a trial", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: true,
        hasPerpetualAccess: true,
        liveSubscriptions: [{ status: "trialing", trial_end: trialEnd }],
      }),
    ).toEqual({ ok: true, expiresAt: null });
  });

  it.each(["active", "past_due"] as const)(
    "does not cap %s subscription access",
    (status) => {
      expect(
        resolveOfflineAccessExpiry({
          hasAccess: true,
          hasPerpetualAccess: false,
          liveSubscriptions: [
            { status: "trialing", trial_end: trialEnd },
            { status, trial_end: trialEnd },
          ],
        }),
      ).toEqual({ ok: true, expiresAt: null });
    },
  );

  it("returns the mirrored trial end when trialing is the only access source", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: true,
        hasPerpetualAccess: false,
        liveSubscriptions: [{ status: "trialing", trial_end: trialEnd }],
      }),
    ).toEqual({ ok: true, expiresAt: trialEnd });
  });

  it.each([null, "not-a-date"])(
    "rejects a trial with invalid end %s",
    (invalidEnd) => {
      expect(
        resolveOfflineAccessExpiry({
          hasAccess: true,
          hasPerpetualAccess: false,
          liveSubscriptions: [{ status: "trialing", trial_end: invalidEnd }],
        }),
      ).toEqual({ ok: false });
    },
  );

  it("rejects active access with no recognized source", () => {
    expect(
      resolveOfflineAccessExpiry({
        hasAccess: true,
        hasPerpetualAccess: false,
        liveSubscriptions: [],
      }),
    ).toEqual({ ok: false });
  });
});
```

- [ ] **Step 3: Extend the balance route source contract test**

Add a second test to `tests/billing/balance-route-source.test.ts`:

```ts
it("publishes a trial-only offline access expiry", async () => {
  const source = await readFile("app/api/v1/billing/balance/route.ts", "utf8");

  expect(source).toContain("resolveOfflineAccessExpiry");
  expect(source).toContain('supabase.rpc("has_active_license")');
  expect(source).toContain('.from("subscriptions")');
  expect(source).toContain("offline_access_expires_at");
  expect(source).toContain("accessSourceResolution.ok");
});
```

- [ ] **Step 4: Run focused tests and verify RED**

Run:

```bash
pnpm test tests/billing/offline-access-expiry.test.ts tests/billing/balance-route-source.test.ts
```

Expected: module-not-found failure for `offline-access-expiry` and source assertion failures.

- [ ] **Step 5: Implement the pure resolver**

Create `lib/billing/offline-access-expiry.ts`:

```ts
export type LiveSubscriptionAccess = {
  status: "trialing" | "active" | "past_due";
  trial_end: string | null;
};

export type OfflineAccessExpiryResolution =
  | { ok: true; expiresAt: string | null }
  | { ok: false };

export function resolveOfflineAccessExpiry({
  hasAccess,
  hasPerpetualAccess,
  liveSubscriptions,
}: {
  hasAccess: boolean;
  hasPerpetualAccess: boolean;
  liveSubscriptions: LiveSubscriptionAccess[];
}): OfflineAccessExpiryResolution {
  if (!hasAccess || hasPerpetualAccess) {
    return { ok: true, expiresAt: null };
  }

  if (
    liveSubscriptions.some(
      ({ status }) => status === "active" || status === "past_due",
    )
  ) {
    return { ok: true, expiresAt: null };
  }

  const trial = liveSubscriptions.find(({ status }) => status === "trialing");
  if (
    !trial?.trial_end ||
    Number.isNaN(Date.parse(trial.trial_end))
  ) {
    return { ok: false };
  }

  return { ok: true, expiresAt: trial.trial_end };
}
```

- [ ] **Step 6: Integrate source resolution into the balance Route Handler**

Add imports:

```ts
import {
  resolveOfflineAccessExpiry,
  type LiveSubscriptionAccess,
} from "@/lib/billing/offline-access-expiry";
```

Expand the license type:

```ts
let license:
  | {
      active: boolean;
      granted_at: string | null;
      offline_access_expires_at?: string;
    }
  | undefined;
```

Replace the existing `if (!licenseError && typeof active === "boolean")`
block with:

```ts
if (!licenseError && typeof active === "boolean") {
  hasAccess = active;
  let grantedAt: string | null = null;
  if (hasAccess) {
    const { data: licenseRow } = await supabase
      .from("licenses")
      .select("granted_at")
      .eq("status", "active")
      .maybeSingle();
    grantedAt = licenseRow?.granted_at ?? null;
  }

  if (!hasAccess) {
    license = { active: false, granted_at: grantedAt };
  } else {
    const [
      { data: perpetualAccess, error: perpetualAccessError },
      { data: subscriptionRows, error: subscriptionError },
    ] = await Promise.all([
      supabase.rpc("has_active_license"),
      supabase
        .from("subscriptions")
        .select("status, trial_end")
        .in("status", ["trialing", "active", "past_due"])
        .order("created_at", { ascending: false }),
    ]);

    if (
      perpetualAccessError ||
      subscriptionError ||
      typeof perpetualAccess !== "boolean"
    ) {
      console.error("billing balance: failed to resolve access source", {
        perpetualAccessError: perpetualAccessError?.message,
        subscriptionError: subscriptionError?.message,
      });
    } else {
      const accessSourceResolution = resolveOfflineAccessExpiry({
        hasAccess,
        hasPerpetualAccess: perpetualAccess,
        liveSubscriptions: (subscriptionRows ?? []) as LiveSubscriptionAccess[],
      });

      if (!accessSourceResolution.ok) {
        console.error(
          "billing balance: active access has no valid offline expiry source",
        );
      } else {
        license = {
          active: true,
          granted_at: grantedAt,
          ...(accessSourceResolution.expiresAt
            ? {
                offline_access_expires_at:
                  accessSourceResolution.expiresAt,
              }
            : {}),
        };
      }
    }
  }
}
```

Keep `export const dynamic = "force-dynamic"` and `Response.json(...)`. Next
16 Route Handlers are request-time by default, and this route already
explicitly requires dynamic behavior.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
pnpm test tests/billing/offline-access-expiry.test.ts tests/billing/balance-route-source.test.ts
```

Expected: both files pass.

- [ ] **Step 8: Type-check through the production build**

Run:

```bash
pnpm build
```

Expected: Next 16.2.3 production build succeeds. If the sandbox reports a
Turbopack port or temp-directory permission error, rerun the same command in
the normal unsandboxed project shell before changing code.

- [ ] **Step 9: Check and commit**

Run:

```bash
git diff --check
git add lib/billing/offline-access-expiry.ts tests/billing/offline-access-expiry.test.ts app/api/v1/billing/balance/route.ts tests/billing/balance-route-source.test.ts
git commit -m "feat(billing): publish offline trial expiry"
```

Expected: one focused `woven-video` backend contract commit.

---

### Task 4: Change Future Stripe Trials and Transactional Copy to Three Days

**Repository:** `woven-video` isolated worktree

**Files:**

- Modify: `tests/billing/subscription-checkout.test.ts`
- Modify: `tests/billing/subscription-offer.test.ts`
- Modify: `tests/billing/checkout-result.test.ts`
- Modify: `supabase/functions/create-checkout-session/subscription.ts`
- Modify: `components/account/subscription-offer.ts`
- Modify: `components/checkout/checkout-result.tsx`
- Modify: `components/account/start-trial-button.tsx`
- Modify: `app/account/page.tsx`

**Interfaces:**

- Produces: eligible Checkout `subscription_data.trial_period_days === 3`.
- Preserves: trial-used Checkout with no trial parameters.
- Produces: exact account/return three-day copy with no email promise.

- [ ] **Step 1: Change tests to the approved contract**

In `subscription-checkout.test.ts`, change the eligible trial expectation to:

```ts
expect(plan.params.subscription_data).toEqual({
  trial_period_days: 3,
  trial_settings: {
    end_behavior: { missing_payment_method: "cancel" },
  },
  metadata: {
    user_id: "user_123",
    purpose: "subscription",
    trial_eligible: "true",
  },
});
```

Keep both trial-used tests asserting that `trial_period_days` and
`trial_settings` are absent.

In `subscription-offer.test.ts`, use:

```ts
expect(getNoAccessSubscriptionOffer("trial")).toEqual({
  title: "Start your free trial",
  buttonLabel: "Start your 3-day free trial",
  bullets: [
    "$5 in Woven-hosted credits to try hosted models",
    "Bring your own Anthropic and OpenAI keys, or sign in with ChatGPT",
  ],
  emphasizedFinePrint: "$0 due today",
  finePrint: "cancel anytime before day 3 · card required.",
});
```

In the trial checkout-result test, add the exact body:

```ts
expect(copy.body).toBe(
  "You have full access to Woven for the next 3 days, and $5 in hosted credits have been added to your balance. You won't be charged until your trial ends.",
);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm test tests/billing/subscription-checkout.test.ts tests/billing/subscription-offer.test.ts tests/billing/checkout-result.test.ts
```

Expected: failures show seven days and the email promise.

- [ ] **Step 3: Change only future Checkout creation**

In `buildSubscriptionCheckoutSession`, change:

```ts
subscriptionData.trial_period_days = 3;
```

Do not add a Subscription update call and do not change the trial-used branch.

- [ ] **Step 4: Update transactional trial presentation**

In `getNoAccessSubscriptionOffer("trial")`, use:

```ts
return {
  title: "Start your free trial",
  buttonLabel: "Start your 3-day free trial",
  bullets: [
    "$5 in Woven-hosted credits to try hosted models",
    bringYourOwnKeysBullet,
  ],
  emphasizedFinePrint: "$0 due today",
  finePrint: "cancel anytime before day 3 · card required.",
};
```

In `components/checkout/checkout-result.tsx`, use:

```ts
body:
  "You have full access to Woven for the next 3 days, and $5 in hosted credits have been added to your balance. You won't be charged until your trial ends.",
```

Change the default in `StartTrialButton` to:

```ts
label = "Start your 3-day free trial"
```

Change the trialing success alert in `app/account/page.tsx` to:

```tsx
<Alert tone="success">
  Your free trial is starting. Welcome to Woven — your $5 in hosted
  credits is on its way. You won&apos;t be charged until day 3.
</Alert>
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: all three files pass.

- [ ] **Step 6: Check and commit**

Run:

```bash
git diff --check
git add supabase/functions/create-checkout-session/subscription.ts tests/billing/subscription-checkout.test.ts components/account/subscription-offer.ts tests/billing/subscription-offer.test.ts components/checkout/checkout-result.tsx tests/billing/checkout-result.test.ts components/account/start-trial-button.tsx app/account/page.tsx
git commit -m "fix(billing): shorten new trials to three days"
```

Expected: one runtime/transactional-copy commit.

---

### Task 5: Update Current Marketing, Legal, SEO, and Support Copy

**Repository:** `woven-video` isolated worktree

**Files:**

- Create: `tests/billing/trial-copy-source.test.ts`
- Modify: current production-copy files listed in the File Structure section.

**Interfaces:**

- Produces: no current product source containing seven-day trial, day-7 cancellation, trial-email, or seven-day refund promises.
- Preserves: all pricing, `$5` credit, BYOK, ChatGPT, and annual subscription claims.

- [ ] **Step 1: Write the failing current-surface regression scan**

Create `tests/billing/trial-copy-source.test.ts`:

```ts
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const currentTrialSurfaces = [
  "app/page.tsx",
  "app/pricing/page.tsx",
  "app/terms/page.tsx",
  "app/account/page.tsx",
  "components/marketing/page-sections.tsx",
  "components/account/subscription-offer.ts",
  "components/account/start-trial-button.tsx",
  "components/checkout/checkout-result.tsx",
  "components/contact/contact-form.tsx",
  "lib/seo/constants.ts",
  "lib/seo/faqs.ts",
  "lib/seo/hubs.ts",
  "lib/seo/landing-pages.ts",
  "lib/seo/schema.ts",
] as const;

const staleTrialCopy = /7[- ]day|7 days|day 7/i;
const staleEmailPromise = /we email you before your trial ends/i;
const staleRefundPromise = /refund within (?:your )?7[- ]day/i;

describe("current three-day trial copy", () => {
  for (const path of currentTrialSurfaces) {
    it(`${path} contains no stale seven-day offer`, async () => {
      const source = await readFile(path, "utf8");

      expect(source).not.toMatch(staleTrialCopy);
      expect(source).not.toMatch(staleEmailPromise);
      expect(source).not.toMatch(staleRefundPromise);
    });
  }
});
```

This intentionally excludes migrations, docs, changelog, appcast history,
workers, and unrelated runtime constants.

- [ ] **Step 2: Run the scan and verify RED**

Run:

```bash
pnpm test tests/billing/trial-copy-source.test.ts
```

Expected: failures enumerate current seven-day/email/refund surfaces.

- [ ] **Step 3: Apply exact trial-duration replacements**

Use `apply_patch` to make these replacements in the listed production files:

```text
7-day free trial              -> 3-day free trial
free 7-day trial              -> free 3-day trial
7-day trial                   -> 3-day trial
7 days free                   -> 3 days free
free for 7 days               -> free for 3 days
Try Woven free for 7 days     -> Try Woven free for 3 days
Try it free for 7 days        -> Try it free for 3 days
before day 7                  -> before day 3
until day 7                   -> until day 3
next 7 days                   -> next 3 days
```

Apply them only to current source paths in `currentTrialSurfaces`. Preserve
unrelated seven-day retention and historical files.

- [ ] **Step 4: Remove email and refund promises with final copy**

Where an offer line currently ends with the email promise, make it:

```text
$0 due today · cancel anytime before day 3 · card required.
```

In `components/contact/contact-form.tsx`, replace the refund description with:

```tsx
<FieldDescription>
  Include your account email so we can find your billing history.
</FieldDescription>
```

In `app/terms/page.tsx`, use:

```tsx
You need a Woven account to use the app. We offer a 3-day free trial,
then a paid subscription as described on our{" "}
```

Keep the following existing sentence unchanged:

```tsx
Cancel before the trial ends to avoid being charged.
```

- [ ] **Step 5: Run the scan and verify GREEN**

Run:

```bash
pnpm test tests/billing/trial-copy-source.test.ts
```

Expected: all current-surface cases pass.

- [ ] **Step 6: Inspect the exact remaining seven-day references**

Run:

```bash
rg -n -i --glob '!docs/superpowers/**' --glob '!CHANGELOG.md' --glob '!scripts/appcast.xml' --glob '!workers/**' --glob '!tests/**' "7[- ]day|7 days|day 7|we email you before your trial ends|refund within.*7" app components lib supabase
```

Expected: only historical migration comments or unrelated non-offer constants,
if any. Every result must be classified; no current trial/refund promise may
remain.

- [ ] **Step 7: Run billing tests and commit**

Run:

```bash
pnpm test tests/billing
git diff --check
git add app/page.tsx app/pricing/page.tsx app/terms/page.tsx app/account/page.tsx components/marketing/page-sections.tsx components/account/subscription-offer.ts components/account/start-trial-button.tsx components/checkout/checkout-result.tsx components/contact/contact-form.tsx lib/seo/constants.ts lib/seo/faqs.ts lib/seo/hubs.ts lib/seo/landing-pages.ts lib/seo/schema.ts tests/billing/trial-copy-source.test.ts
git commit -m "fix(marketing): publish three-day trial offer"
```

Expected: billing tests pass and the third `woven-video` implementation commit
contains only current product copy plus its regression scan.

---

### Task 6: Run the Cross-Repo Verification Gate

**Repositories:** both isolated worktrees

**Files:** no intended changes.

**Interfaces:**

- Consumes: Tasks 1–5.
- Produces: two clean, independently reviewable implementation branches ready for coordinated release.

- [ ] **Step 1: Verify Harness focused behavior**

Run:

```bash
xcodebuild -quiet -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' -derivedDataPath /private/tmp/woven-three-day-trial-final-dd CODE_SIGNING_ALLOWED=NO test -only-testing:WovenHarnessTests/BalanceDecodingTests -only-testing:WovenHarnessTests/LicenseGateTests -only-testing:WovenHarnessTests/AcquisitionPresentationTests -only-testing:WovenHarnessTests/BillingAcquisitionSourceTests
```

Expected: focused suites pass.

- [ ] **Step 2: Verify the complete Harness project**

Run:

```bash
xcodebuild -quiet -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' -derivedDataPath /private/tmp/woven-three-day-trial-final-dd CODE_SIGNING_ALLOWED=NO test
xcodebuild -quiet -project WovenHarness.xcodeproj -scheme WovenHarness -configuration Debug -destination 'platform=macOS' -derivedDataPath /private/tmp/woven-three-day-trial-final-dd CODE_SIGNING_ALLOWED=NO build
git diff --check
git status --short --branch
```

Expected: full tests and Debug build pass; feature branch is clean.

- [ ] **Step 3: Verify `woven-video`**

Run:

```bash
pnpm test tests/billing
pnpm lint
pnpm build
git diff --check
git status --short --branch
```

Expected: billing tests, lint, and production build pass; feature branch is
clean.

- [ ] **Step 4: Review scope and release order**

Run in each repository:

```bash
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected Harness commits:

```text
feat(billing): cap cached trial access at expiry
fix(billing): advertise three-day free trial
```

Expected `woven-video` implementation commits after the already approved docs:

```text
feat(billing): publish offline trial expiry
fix(billing): shorten new trials to three days
fix(marketing): publish three-day trial offer
```

Do not release or deploy if unrelated files appear.

---

### Task 7: Release Harness v0.1.64 First

**Repository:** Harness isolated worktree

**Files:**

- Modify: `project.yml`
- Modify: `CHANGELOG.md`
- Modify after artifact generation: `scripts/appcast.xml`

**Interfaces:**

- Produces: notarized `Woven-0.1.64.dmg`, stable `Woven.dmg`, appcast entry, GitHub tag/release.
- Establishes: current downloadable Harness says three days before the backend cutover.

- [ ] **Step 1: Add exact release metadata**

Change `project.yml`:

```yaml
CFBundleShortVersionString: "0.1.64"
CFBundleVersion: "64"
```

Add to the top of `CHANGELOG.md` after its introduction:

```markdown
## v0.1.64 — 2026-07-31

- Free trials now show the new 3-day duration throughout the Woven paywall.
- Trial access cached for offline use now stops at the trial's actual end time, while paid and grandfathered users keep the existing offline grace.
- Removed stale promises about trial reminder emails and seven-day refund requests.
```

- [ ] **Step 2: Regenerate and reverify**

Run:

```bash
xcodegen generate
xcodebuild -quiet -project WovenHarness.xcodeproj -scheme WovenHarness -destination 'platform=macOS' -derivedDataPath /private/tmp/woven-three-day-trial-release-dd CODE_SIGNING_ALLOWED=NO test
git diff --check
```

Expected: generated project succeeds and all tests pass.

- [ ] **Step 3: Run the signed release workflow**

Run:

```bash
./scripts/release.sh
```

Expected:

- signed, notarized, and stapled app
- signed, notarized, and stapled `build/release/Woven-0.1.64.dmg`
- successful app and Remotion smoke checks
- R2 uploads for the versioned DMG and stable alias
- generated `build/release/appcast-entry.xml`

- [ ] **Step 4: Publish the generated appcast entry**

Use `apply_patch` to insert the exact generated
`build/release/appcast-entry.xml` `<item>` immediately after the `<language>`
line in `scripts/appcast.xml`. Then run the upload command printed by
`release.sh`:

```bash
wrangler r2 object put woven-updates/appcast.xml --file scripts/appcast.xml --content-type application/xml --remote
```

Verify:

```bash
curl -sI https://release.woven.video/Woven-0.1.64.dmg
curl -sI https://release.woven.video/Woven.dmg
curl -s https://release.woven.video/appcast.xml | head -40
```

Expected: both DMGs return `200`; appcast begins with version `0.1.64` and
Sparkle build `64`.

- [ ] **Step 5: Commit, review, and merge the Harness release**

Run:

```bash
git add project.yml CHANGELOG.md scripts/appcast.xml
git commit -m "Release v0.1.64"
git push -u origin feat/three-day-trial-harness
gh pr create --base main --head feat/three-day-trial-harness --title "Release Woven v0.1.64 with three-day trial copy" --body "Updates the free-trial presentation to three days, caps cached trial access at the backend-provided Stripe trial expiry, preserves paid-user offline grace, and removes stale reminder/refund promises."
gh pr view --web
```

Review the PR diff and checks. Then:

```bash
gh pr merge --rebase --delete-branch
git fetch origin main
git tag v0.1.64 origin/main
git push origin v0.1.64
gh release create v0.1.64 build/release/Woven-0.1.64.dmg --title "Woven v0.1.64" --notes "Woven now presents the 3-day free trial accurately and caps offline trial access at the actual trial end, while preserving the existing offline grace for paid and grandfathered users."
```

Expected: PR merged, tag and GitHub release public.

- [ ] **Step 6: Verify the exact released app**

Download or mount the public `Woven-0.1.64.dmg`, confirm signature/notarization,
launch that exact build, sign in with a trial-eligible test account against the
still-seven-day backend, and verify:

```text
3 days free, then $99/year. Cancel anytime.
$0 due today · cancel anytime before day 3 · card required.
Start your 3-day free trial
```

The temporary underpromise is accepted. Do not start a live Checkout during
this pre-cutover visual smoke.

---

### Task 8: Deploy `woven-video`, Cut Over Checkout Last, and Verify Operations

**Repository:** `woven-video` isolated worktree

**Files:** no additional intended source changes.

**Interfaces:**

- Produces: live three-day web/API presentation, then live three-day Checkout.
- Preserves: existing Stripe `trial_end` values.
- Preserves rollback rule: restoring seven days changes only future Checkout
  creation and current copy; it never rewrites subscriptions already created
  with three days.

- [ ] **Step 1: Push and merge the verified `woven-video` branch**

Run:

```bash
git push -u origin feat/three-day-trial
gh pr create --base main --head feat/three-day-trial --title "Change Woven free trials to three days" --body "Changes future Stripe Checkout trials to 3 days, publishes an optional trial-only offline cache expiry, updates current web/legal/SEO copy, and preserves existing trials, trial-used checkout, $5 credits, and paid-user offline grace."
gh pr view --web
```

Review the PR diff and checks. Then:

```bash
gh pr merge --rebase --delete-branch
git fetch origin main
```

Expected: verified commits land on `origin/main`.

- [ ] **Step 2: Wait for Vercel before changing Checkout**

Read the merged commit SHA:

```bash
git rev-parse origin/main
```

Poll that commit's GitHub/Vercel status:

```bash
gh api repos/namank42/woven-video/commits/origin/main/status
```

If `origin/main` is not accepted by the API as a ref, substitute the exact SHA
printed by `git rev-parse origin/main`.

Expected: Vercel deployment succeeds before the Edge Function is deployed.

- [ ] **Step 3: Verify live web copy and additive API source**

Run:

```bash
curl -s https://www.woven.video/pricing | rg -n "3-day free trial|free for 3 days|before day 3"
curl -s https://www.woven.video/terms | rg -n "3-day free trial"
curl -s https://www.woven.video/ | rg -n "free for 3 days|3-day free trial"
```

Expected: three-day copy is present and no current page promises seven days.

Using an authenticated non-trial account and a trialing test account, inspect
`GET /api/v1/billing/balance`:

```json
// Paid/grandfathered
{
  "license": {
    "active": true,
    "granted_at": null
  }
}

// Trialing
{
  "license": {
    "active": true,
    "granted_at": null,
    "offline_access_expires_at": "the mirrored subscriptions.trial_end value"
  }
}
```

The actual response timestamp must exactly match that test subscription's
stored `trial_end`. If no trialing test account exists, verify the paid response
live and record the trialing authenticated smoke as pending rather than
creating or mutating a production account without separate authorization.

- [ ] **Step 4: Capture any existing live trials before cutover**

Read all current `status = 'trialing'` rows through the approved read-only
production database path and record:

```text
stripe_subscription_id
trial_end
```

Expected: a read-only snapshot, possibly empty. Do not update any row or Stripe
Subscription.

- [ ] **Step 5: Deploy the Checkout Edge Function**

Run:

```bash
supabase functions deploy create-checkout-session --project-ref rlhjpovwwsqdeklhnvfl
```

Expected: deployment succeeds. This is the exact moment newly completed trial
Checkouts switch to three days.

- [ ] **Step 6: Verify three-day Checkout in Stripe test mode**

Using the existing Stripe test configuration and a trial-eligible local/test
account, create and complete a subscription Checkout. Verify in Stripe:

```text
status = trialing
trial_end - trial_start = approximately 3 days
price = $99/year
payment method collected
```

Verify Woven:

```text
$5 trial credit granted exactly once
license.active = true
offline_access_expires_at = Stripe trial_end
```

Repeat the checkout-helper unit test to guard the deployed source contract:

```bash
pnpm test tests/billing/subscription-checkout.test.ts tests/billing/offline-access-expiry.test.ts
```

Expected: pass.

- [ ] **Step 7: Prove existing trials were not changed**

Repeat the Step 4 read-only query and compare every pre-cutover
`stripe_subscription_id`:

```text
trial_end after deployment = trial_end before deployment
```

Expected: exact equality. A normal webhook status transition that occurred
independently must be reported separately; never "correct" it with a bulk
update.

- [ ] **Step 8: Verify Stripe-hosted trial reminder settings**

In the production Stripe Dashboard:

1. Open Billing → Subscriptions and emails.
2. Enable the Stripe-hosted trial-ending reminder with the hosted management
   link if it is off.
3. Confirm the Customer Portal cancellation path is still enabled.
4. Record that a three-day trial receives Stripe's reminder when the trial
   begins; do not restore the removed in-product email promise.

Expected: reminder and cancellation settings are visibly enabled. No Loops
workflow or code is changed.

- [ ] **Step 9: Record the rollback boundary**

Record the merged `woven-video` commit, Harness release tag, and successful
Edge Function deployment output in the release handoff.

If the offer must return to seven days, use a focused follow-up commit that
restores the current copy and `trial_period_days: 7`. Deploy the Edge Function
first, then publish seven-day web copy and a matching Harness patch; that order
briefly grants seven days while displaying three and never does the reverse.
Do not call Stripe's Subscription update API and do not alter stored
`trial_end` values.

- [ ] **Step 10: Final public acceptance**

Verify and report each gate separately:

```text
Harness v0.1.64 released and exact UI checked
Vercel web/API deployment live
create-checkout-session Edge Function deployed
new Stripe test trial lasts 3 days
pre-existing live trial_end values unchanged
paid/grandfathered seven-day offline grace tests pass
trial cache locks at exact offline_access_expires_at
Stripe-hosted reminder setting verified
production authenticated trial smoke: completed or explicitly pending
```

Do not claim production Checkout behavior was authenticated if only test-mode,
source, and public-copy verification were completed.
