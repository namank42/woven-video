#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const envFile = ".env.local";
const triggerProjectRef =
  process.env.TRIGGER_PROJECT_REF ?? readDotenvValue(envFile, "TRIGGER_PROJECT_REF");

if (!triggerProjectRef) {
  console.error("TRIGGER_PROJECT_REF is required for Trigger.dev media execution.");
  process.exit(1);
}

const child = spawn("npx", [
  "trigger.dev@latest",
  "dev",
  "start",
  "--project-ref",
  triggerProjectRef,
  "--env-file",
  envFile,
  "--skip-update-check",
], {
  stdio: "inherit",
  env: {
    ...process.env,
    TRIGGER_PROJECT_REF: triggerProjectRef,
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

function readDotenvValue(filePath, key) {
  if (!existsSync(filePath)) return null;

  const prefix = `${key}=`;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.startsWith(prefix)) {
      continue;
    }
    return unquote(trimmed.slice(prefix.length).trim());
  }

  return null;
}

function unquote(value) {
  const first = value.at(0);
  const last = value.at(-1);
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }
  return value;
}
