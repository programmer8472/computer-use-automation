import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { EvidencePackageWriter, PrivacyGateway } from "@computer-use/evidence";
import { ReplayExecutor } from "@computer-use/replay";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium } from "playwright";

const arguments_ = parseArguments(process.argv.slice(2));
const capability = JSON.parse(
  await readFile(arguments_.capability, "utf8"),
) as unknown;
const baseUrl = process.env.CONTACTS_BASE_URL ?? "http://127.0.0.1:4173";
const origin = new URL(baseUrl).origin;
const runId = `replay-${randomUUID()}`;
const evidenceDirectory = join(process.cwd(), "evidence", "generated", runId);
const browser = await chromium.launch({ headless: !arguments_.headed });

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const privacy = new PrivacyGateway({ redactEmails: true });
  const executor = new ReplayExecutor({
    surface: new PlaywrightSurfaceAdapter(page, {
      allowedOrigins: [origin],
      allowedRoutes: ["/contacts", "/contacts/*"],
    }),
    runtimePolicy: {
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
    evidence: new EvidencePackageWriter(evidenceDirectory, runId, {
      privacyGateway: privacy,
    }),
  });
  const result = await executor.run({
    runId,
    capability,
    inputs: { memberId: arguments_.memberId, phone: arguments_.phone },
    startUrl: `${origin}/contacts`,
  });
  process.stdout.write(
    `${JSON.stringify({ ...result, modelCallCount: 0, evidenceDirectory }, null, 2)}\n`,
  );
  if (result.kind !== "success") process.exitCode = 1;
} finally {
  await browser.close();
}

function parseArguments(values: string[]): {
  capability: string;
  memberId: string;
  phone: string;
  headed: boolean;
} {
  const parsed = new Map<string, string>();
  let headed = false;
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--headed") {
      headed = true;
      continue;
    }
    const value = values[index + 1];
    if (name?.startsWith("--") !== true || value === undefined) {
      throw new Error("Arguments must be supplied as --name value pairs");
    }
    parsed.set(name.slice(2), value);
    index += 1;
  }
  const capability = parsed.get("capability");
  const memberId = parsed.get("member-id");
  const phone = parsed.get("phone");
  if (
    capability === undefined ||
    memberId === undefined ||
    phone === undefined
  ) {
    throw new Error(
      "Usage: npm run replay -- --capability <approved.json> --member-id <M-0000> --phone <number> [--headed]",
    );
  }
  return { capability, memberId: memberId.toUpperCase(), phone, headed };
}
