import { createHash, timingSafeEqual } from "node:crypto";

// Hashing both inputs first makes unequal lengths safe to compare.
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
