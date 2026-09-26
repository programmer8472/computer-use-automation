import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { compileContactUpdateCapability } from "@computer-use/compiler";
import type { DiscoveryTrace } from "@computer-use/discovery";

const arguments_ = parseArguments(process.argv.slice(2));
const trace = JSON.parse(await readFile(arguments_.trace, "utf8")) as unknown;
const origin = new URL(process.env.CONTACTS_BASE_URL ?? "http://127.0.0.1:4173")
  .origin;
const capability = compileContactUpdateCapability(trace as DiscoveryTrace, {
  allowedOrigin: origin,
  evidenceManifestRef: arguments_.manifest,
  reviewedPolicy: {
    allowedOrigins: [origin],
    allowedRoutes: ["/contacts", "/contacts/*"],
    allowedActions: ["click", "fill"],
    blockedDataClasses: ["sensitive", "credential", "full_ssn"],
    maximumRecoveryAttempts: 1,
    requiredApprovals: [
      { risk: "high", authority: "human_operator" },
      { risk: "critical", authority: "human_operator" },
    ],
  },
});

await mkdir(dirname(arguments_.out), { recursive: true });
await writeFile(arguments_.out, `${JSON.stringify(capability, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
process.stdout.write(`Draft capability written to ${arguments_.out}\n`);

function parseArguments(values: string[]): {
  trace: string;
  manifest: string;
  out: string;
} {
  const parsed = readNamedArguments(values);
  const trace = parsed.get("trace");
  const manifest = parsed.get("manifest");
  if (trace === undefined || manifest === undefined) {
    throw new Error(
      "Usage: npm run capability:compile -- --trace <trace.json> --manifest <manifest.json> [--out <draft.json>]",
    );
  }
  return {
    trace,
    manifest,
    out: parsed.get("out") ?? "capabilities/contact-update.draft.json",
  };
}

function readNamedArguments(values: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (name?.startsWith("--") !== true || value === undefined) {
      throw new Error("Arguments must be supplied as --name value pairs");
    }
    parsed.set(name.slice(2), value);
  }
  return parsed;
}
