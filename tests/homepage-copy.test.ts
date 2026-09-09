import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homepageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");

describe("homepage copy", () => {
  it("does not claim hosted credits use the same lineup as BYOK", () => {
    expect(homepageSource).not.toContain("same lineup");
  });

  it("does not describe hosted credits as Claude-and-GPT-only", () => {
    expect(homepageSource).not.toContain("Woven-hosted Claude and GPT");
  });

  it("does not promise BYOK chat keys", () => {
    expect(homepageSource).not.toContain("Bring your own Anthropic");
  });

  it("does not promise BYOK chat keys in headlines", () => {
    expect(homepageSource).not.toContain("Your keys, or ours");
    expect(homepageSource).not.toContain("Your keys, ChatGPT");
  });
});
