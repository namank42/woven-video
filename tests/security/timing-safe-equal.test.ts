import { describe, expect, it } from "vitest";

import { timingSafeEqualStrings } from "@/lib/security/timing-safe-equal";

describe("timingSafeEqualStrings", () => {
  it("matches equal strings", () => expect(timingSafeEqualStrings("abc", "abc")).toBe(true));

  it("rejects different strings", () => expect(timingSafeEqualStrings("abc", "abd")).toBe(false));

  it("rejects different lengths without throwing", () =>
    expect(timingSafeEqualStrings("abc", "abcdef")).toBe(false));

  it("rejects empty vs non-empty", () => expect(timingSafeEqualStrings("", "abc")).toBe(false));
});
