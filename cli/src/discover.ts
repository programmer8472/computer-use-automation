import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  DiscoveryRunner,
  OpenAIDiscoveryModel,
  type DiscoveryInput,
} from "@computer-use/discovery";
import { EvidencePackageWriter, PrivacyGateway } from "@computer-use/evidence";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium } from "playwright";

const arguments_ = parseArguments(process.argv.slice(2));
const baseUrl = process.env.CONTACTS_BASE_URL ?? "http://127.0.0.1:4173";
const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error(
    "OPENAI_API_KEY is not configured. Add it to the local .env file without sharing or committing it.",
  );
}

const modelName = process.env.OPENAI_MODEL ?? "gpt-6-luna";
const runId = `run-${randomUUID()}`;
const privacy = new PrivacyGateway({ redactEmails: true });
const inputs: Record<string, DiscoveryInput> = {
  memberId: {
    value: arguments_.memberId,
    dataClass: "personal",
    description: "Synthetic member identifier",
  },
  phone: {
    value: arguments_.phone,
    dataClass: "personal",
    description: "Replacement synthetic phone number",
  },
};

const browser = await chromium.launch({ headless: !arguments_.headed });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const origin = new URL(baseUrl).origin;
  const surface = new PlaywrightSurfaceAdapter(page, {
    allowedOrigins: [origin],
    allowedRoutes: ["/contacts", "/contacts/*"],
  });
  const evidenceDirectory = join(process.cwd(), "evidence", "generated", runId);
  const runner = new DiscoveryRunner({
    model: new OpenAIDiscoveryModel({ apiKey, model: modelName }),
    surface,
    evidence: new EvidencePackageWriter(evidenceDirectory, runId, {
      privacyGateway: privacy,
    }),
    privacyGateway: privacy,
  });
  const result = await runner.run({
    runId,
    goal: arguments_.goal,
    startUrl: `${origin}/contacts`,
    inputs,
    policy: {
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
    verifySuccess: async () => {
      const phone = page.getByText(arguments_.phone, { exact: true });
      return (
        page.url().includes(`/contacts/${arguments_.memberId}`) &&
        (await phone.isVisible())
      );
    },
  });

  process.stdout.write(
    `${JSON.stringify({ ...result, evidenceDirectory }, null, 2)}\n`,
  );
  if (result.kind !== "success") process.exitCode = 1;
} finally {
  await browser.close();
}

function parseArguments(values: string[]): {
  goal: string;
  memberId: string;
  phone: string;
  headed: boolean;
} {
  const parsed = new Map<string, string>();
  let headed = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--headed") {
      headed = true;
      continue;
    }
    if (value?.startsWith("--") === true) {
      const next = values[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for ${value}`);
      }
      parsed.set(value.slice(2), next);
      index += 1;
    }
  }

  const goal = parsed.get("goal");
  const memberId = parsed.get("member-id");
  const phone = parsed.get("phone");
  if (goal === undefined || memberId === undefined || phone === undefined) {
    throw new Error(
      "Usage: npm run discover -- --goal <goal> --member-id <M-0000> --phone <number> [--headed]",
    );
  }
  return { goal, memberId: memberId.toUpperCase(), phone, headed };
}
