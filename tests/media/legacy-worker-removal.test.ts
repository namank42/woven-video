import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const pathFromRepo = (...parts: string[]) => join(repoRoot, ...parts);

describe("legacy executor cleanup", () => {
  it("removes unsupported polling " + "worker entrypoints and updates operator docs", () => {
    expect(existsSync(pathFromRepo("scripts", ["media", "worker.ts"].join("-")))).toBe(false);
    expect(existsSync(pathFromRepo("app", "api", "internal", "media", "jobs", "drain", "route.ts"))).toBe(false);
    expect(existsSync(pathFromRepo("lib", "media", ["worker", "ts"].join(".")))).toBe(false);
    expect(existsSync(pathFromRepo("lib", "media", ["worker", "startup.ts"].join("-")))).toBe(false);
    expect(existsSync(pathFromRepo("tests", "media", ["worker", "startup.test.ts"].join("-")))).toBe(false);
    expect(existsSync(pathFromRepo("tests", "media", ["worker", "test.ts"].join(".")))).toBe(false);
    expect(existsSync(pathFromRepo("tests", "media", ["drain", "route.test.ts"].join("-")))).toBe(false);

    const envExample = readFileSync(pathFromRepo(".env.example"), "utf8");
    expect(envExample).toContain("TRIGGER_PROJECT_REF=");
    expect(envExample).toContain("TRIGGER_SECRET_KEY=");
    expect(envExample).toContain("TRIGGER_ACCESS_TOKEN=");

    const deployDoc = readFileSync(pathFromRepo("docs", ["media", "worker", "deploy.md"].join("-")), "utf8");
    expect(deployDoc).toContain("# Media Executor Deployment");
    expect(deployDoc).toContain("pnpm run media:dev:local");
    expect(deployDoc).toContain("pnpm run media:edge:deploy");
    expect(deployDoc).toContain("pnpm run trigger:deploy");
    expect(deployDoc).toContain("Trigger.dev is the supported executor in local and production.");
    expect(deployDoc).toContain("Do not run a separate polling " + "worker.");
  });
});
