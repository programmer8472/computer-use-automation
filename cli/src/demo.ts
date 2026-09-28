import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import { join, relative } from "node:path";

import {
  createContactsApp,
  MemberRepository,
  ScenarioController,
} from "@computer-use/contacts";
import {
  approveCapability,
  compileContactUpdateCapability,
} from "@computer-use/compiler";
import {
  CapabilityPackageSchema,
  SCHEMA_VERSION,
  type CapabilityPackage,
  type Check,
  type EvidenceEvent,
  type ExecutionPolicy,
  type TargetLocator,
  type TerminalResult,
} from "@computer-use/contracts";
import type { DiscoveryTrace } from "@computer-use/discovery";
import { EvidencePackageWriter, PrivacyGateway } from "@computer-use/evidence";
import { ReplayExecutor } from "@computer-use/replay";
import {
  BrowserSessionController,
  SsnHandoffCoordinator,
} from "@computer-use/session";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium, type Browser, type Page } from "playwright";

import { verifySubmissionEvidence } from "./evidence-verifier.js";

type EvidenceEventDetails<Event = EvidenceEvent> = Event extends EvidenceEvent
  ? Omit<
      Event,
      "schemaVersion" | "eventId" | "runId" | "sequence" | "timestamp"
    >
  : never;

const demoPort = 4174;
const baseUrl = `http://127.0.0.1:${demoPort}`;
const fixedTime = new Date("2026-09-26T16:00:00.000Z");
const submissionRoot = join(process.cwd(), "evidence", "submission");
const demoRoot = join(submissionRoot, "demo");
assertSafeDemoRoot(demoRoot);
await rm(demoRoot, { recursive: true, force: true });

const repository = new MemberRepository();
const scenarios = new ScenarioController();
let server: Server | undefined;
let browser: Browser | undefined;
const results: ScenarioResult[] = [];

try {
  server = await listen(createContactsApp({ repository, scenarios }), demoPort);
  browser = await chromium.launch({ headless: true });
  const discoveryTrace = await readDiscoveryTrace();
  const contactCapability = approveCapability(
    compileContactUpdateCapability(discoveryTrace, {
      allowedOrigin: baseUrl,
      evidenceManifestRef: "evidence/submission/discovery-live/manifest.json",
      reviewedPolicy: contactPolicy(),
    }),
    "demo-reviewer",
    fixedTime,
  );

  for (const replayCase of [
    {
      name: "replay-wide",
      viewport: { width: 1440, height: 900 },
      memberId: "M-1001",
      phone: "555-0201",
    },
    {
      name: "replay-tablet",
      viewport: { width: 768, height: 1024 },
      memberId: "M-1002",
      phone: "555-0202",
    },
    {
      name: "replay-narrow",
      viewport: { width: 375, height: 667 },
      memberId: "M-1003",
      phone: "555-0203",
    },
  ]) {
    results.push(
      await runReplayScenario({
        browser,
        repository,
        scenarios,
        capability: contactCapability,
        name: replayCase.name,
        viewport: replayCase.viewport,
        inputs: {
          memberId: replayCase.memberId,
          phone: replayCase.phone,
        },
        expected: "success/SUCCESS",
        runtimePolicy: contactPolicy(),
      }),
    );
  }

  results.push(
    await runReplayScenario({
      browser,
      repository,
      scenarios,
      capability: contactCapability,
      name: "missing-contact",
      viewport: { width: 1440, height: 900 },
      inputs: { memberId: "M-9999", phone: "555-0299" },
      expected: "business_outcome/CONTACT_NOT_FOUND",
      runtimePolicy: contactPolicy(),
    }),
  );

  results.push(
    await runReplayScenario({
      browser,
      repository,
      scenarios,
      capability: contactCapability,
      name: "ambiguous-target",
      viewport: { width: 1440, height: 900 },
      inputs: { memberId: "M-1001", phone: "555-0298" },
      expected: "hard_failure/AMBIGUOUS_TARGET",
      runtimePolicy: contactPolicy(),
      scenario: "ambiguous-actions",
    }),
  );

  const transientCapability = createTransientCapability();
  results.push(
    await runReplayScenario({
      browser,
      repository,
      scenarios,
      capability: transientCapability,
      name: "transient-recovery",
      viewport: { width: 1440, height: 900 },
      inputs: {},
      expected: "success/SUCCESS",
      runtimePolicy: navigationPolicy(),
      scenario: "transient-search",
    }),
  );

  results.push(await runHandoffScenario(browser, repository, scenarios));
  await writeMatrixEvidence(results, contactCapability);
} finally {
  if (browser !== undefined) await browser.close();
  if (server !== undefined) await close(server);
}

for (const result of results) {
  process.stdout.write(
    `${result.passed ? "PASS" : "FAIL"} ${result.name.padEnd(20)} expected=${result.expected} actual=${result.actual}\n`,
  );
}
const evidenceVerification = await verifySubmissionEvidence(submissionRoot);
if (!evidenceVerification.valid) {
  for (const error of evidenceVerification.errors) {
    process.stderr.write(`FAIL evidence ${error}\n`);
  }
}
const passed = results.every((result) => result.passed);
if (!passed || !evidenceVerification.valid) {
  process.exitCode = 1;
} else {
  process.stdout.write(
    `PASS evidence             ${evidenceVerification.packages.length} packages verified; privacy scan passed\n`,
  );
}

interface ScenarioResult {
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  evidencePackage: string;
}

interface ReplayScenario {
  browser: Browser;
  repository: MemberRepository;
  scenarios: ScenarioController;
  capability: CapabilityPackage;
  name: string;
  viewport: { width: number; height: number };
  inputs: Readonly<Record<string, unknown>>;
  expected: string;
  runtimePolicy: ExecutionPolicy;
  scenario?: "ambiguous-actions" | "transient-search";
}

async function runReplayScenario(
  input: ReplayScenario,
): Promise<ScenarioResult> {
  input.repository.reset();
  input.scenarios.set(input.scenario ?? "normal");
  const page = await input.browser.newPage({ viewport: input.viewport });
  const runId = `demo-${input.name}`;
  const evidencePackage = `demo/${input.name}`;
  const writer = createWriter(join(submissionRoot, evidencePackage), runId);
  await writer.initialize();
  await writer.writeJsonArtifact("capability.json", input.capability);
  const executor = new ReplayExecutor({
    surface: surface(page),
    runtimePolicy: input.runtimePolicy,
    evidence: writer,
    now: () => fixedTime,
  });

  let result: TerminalResult;
  try {
    result = await executor.run({
      runId,
      capability: input.capability,
      inputs: input.inputs,
      startUrl: `${baseUrl}/contacts`,
    });
  } finally {
    await page.close();
  }
  const actual = describeResult(result);
  return {
    name: input.name,
    expected: input.expected,
    actual,
    passed: actual === input.expected,
    evidencePackage,
  };
}

async function runHandoffScenario(
  activeBrowser: Browser,
  repository: MemberRepository,
  scenarios: ScenarioController,
): Promise<ScenarioResult> {
  repository.reset();
  scenarios.reset();
  const page = await activeBrowser.newPage({
    viewport: { width: 768, height: 1024 },
  });
  const samePage = page;
  const runId = "demo-handoff";
  const evidencePackage = "demo/handoff";
  const writer = createWriter(join(submissionRoot, evidencePackage), runId);
  await writer.initialize();
  let eventSequence = 0;
  const appendEvent = async (event: EvidenceEventDetails): Promise<void> => {
    const sequence = eventSequence;
    eventSequence += 1;
    await writer.appendEvent({
      schemaVersion: SCHEMA_VERSION,
      eventId: `event-${sequence}`,
      runId,
      sequence,
      timestamp: fixedTime.toISOString(),
      ...event,
    });
  };
  await appendEvent({ type: "run_started", mode: "replay" });
  const session = new BrowserSessionController({
    createId: () => "intervention-demo-handoff",
    now: () => fixedTime,
    auditSink: async (entry) => {
      await appendEvent({
        type: "intervention",
        interventionId: entry.interventionId,
        status: entry.status,
      });
    },
  });
  const coordinator = new SsnHandoffCoordinator(surface(page), session);

  try {
    const intervention = await coordinator.prepare({
      runId,
      memberId: "M-1001",
      startUrl: `${baseUrl}/contacts`,
    });
    await session.claim(intervention.interventionId);
    session.assertOwner("operator");

    const syntheticOperatorValue = ["314", "15", "9265"].join("-");
    await page
      .getByLabel("Social Security number (human entry only)")
      .fill(syntheticOperatorValue);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page.waitForURL(/\/contacts\/M-1001\?updated=1&ssnUpdated=1$/);
    await session.release(intervention.interventionId);
    const resumed = await coordinator.resume(intervention.interventionId);
    const proof = {
      kind: "success",
      code: "HANDOFF_RESUMED",
      sameBrowserPage: page === samePage,
      finalLeaseOwner: session.leaseOwner,
      finalInterventionStatus: resumed.status,
      checkpoint: repository.get("M-1001")?.ssnOnFile === true,
      modelCallCount: 0,
      sensitiveValueCaptured: false,
      transitions: session.auditLog.map((entry) => entry.status),
    };
    await appendEvent({
      type: "run_completed",
      resultKind: "success",
      modelCallCount: 0,
    });
    await writer.writeJsonArtifact("result.json", proof);
    await writer.finalize();
    const actual = proof.checkpoint ? "success/HANDOFF_RESUMED" : "failure";
    return {
      name: "handoff",
      expected: "success/HANDOFF_RESUMED",
      actual,
      passed:
        actual === "success/HANDOFF_RESUMED" && proof.sameBrowserPage === true,
      evidencePackage,
    };
  } finally {
    await page.close();
  }
}

async function writeMatrixEvidence(
  scenarioResults: readonly ScenarioResult[],
  capability: CapabilityPackage,
): Promise<void> {
  const writer = createWriter(
    join(submissionRoot, "demo", "matrix"),
    "demo-matrix",
  );
  await writer.initialize();
  await writer.writeJsonArtifact("summary.json", {
    generatedAt: fixedTime.toISOString(),
    application: "Member Contacts Admin",
    resetBeforeEachScenario: true,
    discoveryEvidence: "../../discovery-live/manifest.json",
    capabilityId: capability.capability.id,
    capabilityApproval: capability.approval.status,
    scenarios: scenarioResults,
  });
  await writer.finalize();
}

function createTransientCapability(): CapabilityPackage {
  const memberTarget: TargetLocator = {
    strategies: [{ type: "role", role: "link", name: "M-1001", exact: true }],
    expectedCardinality: 1,
    rationale: "Reviewed member result after search",
  };
  const visibleMember: Check = {
    kind: "element",
    target: memberTarget,
    state: "visible",
  };
  const draft = CapabilityPackageSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    capability: {
      id: "contact.search",
      name: "Search for a member",
      revision: 1,
    },
    approval: { status: "draft" },
    target: {
      appFamily: "member-contacts",
      surface: "legacy_web",
      semanticVersionRange: ">=1.0.0 <2.0.0",
      responsiveVariants: ["wide"],
    },
    inputs: {},
    outputs: {
      found: {
        type: "boolean",
        description: "Whether the member was found",
        required: true,
        dataClass: "public",
      },
    },
    steps: [
      {
        id: "search-member",
        description: "Navigate to a reviewed member search",
        action: {
          type: "navigate",
          urlTemplate: `${baseUrl}/contacts?q=M-1001`,
        },
        preconditions: [{ kind: "url", pattern: "/contacts" }],
        settleConditions: [visibleMember],
        postconditions: [visibleMember],
        timeoutMs: 100,
        effect: "read",
        risk: "low",
        retry: { mode: "safe_retry", maxAttempts: 2, backoffMs: 0 },
      },
    ],
    outcomes: [
      {
        kind: "success",
        code: "SUCCESS",
        finalChecks: [visibleMember],
        outputBindings: { found: "member-found" },
      },
    ],
    policy: navigationPolicy(),
    provenance: {
      discoveryRunId: "transient-search-review",
      evidenceRefs: ["evidence/submission/discovery-live/manifest.json"],
      modelCallCount: 1,
    },
  });
  return approveCapability(draft, "demo-reviewer", fixedTime);
}

async function readDiscoveryTrace(): Promise<DiscoveryTrace> {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(
    await readFile(
      join(submissionRoot, "discovery-live", "trace.json"),
      "utf8",
    ),
  ) as DiscoveryTrace;
}

function surface(page: Page): PlaywrightSurfaceAdapter {
  return new PlaywrightSurfaceAdapter(page, {
    allowedOrigins: [baseUrl],
    allowedRoutes: ["/contacts", "/contacts/*"],
  });
}

function contactPolicy(): ExecutionPolicy {
  return {
    allowedOrigins: [baseUrl],
    allowedRoutes: ["/contacts", "/contacts/*"],
    allowedActions: ["click", "fill"],
    blockedDataClasses: ["sensitive", "credential", "full_ssn"],
    maximumRecoveryAttempts: 1,
    requiredApprovals: [
      { risk: "high", authority: "human_operator" },
      { risk: "critical", authority: "human_operator" },
    ],
  };
}

function navigationPolicy(): ExecutionPolicy {
  return { ...contactPolicy(), allowedActions: ["navigate"] };
}

function createWriter(directory: string, runId: string): EvidencePackageWriter {
  return new EvidencePackageWriter(directory, runId, {
    privacyGateway: new PrivacyGateway({ redactEmails: true }),
    now: () => fixedTime,
  });
}

function describeResult(result: TerminalResult): string {
  return `${result.kind}/${result.code}`;
}

function assertSafeDemoRoot(directory: string): void {
  const expected = join("evidence", "submission", "demo");
  if (relative(process.cwd(), directory) !== expected) {
    throw new Error("Refusing to reset an unexpected evidence directory");
  }
}

async function listen(
  app: ReturnType<typeof createContactsApp>,
  port: number,
): Promise<Server> {
  const activeServer = app.listen(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    activeServer.once("listening", resolve);
    activeServer.once("error", reject);
  });
  return activeServer;
}

async function close(activeServer: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) =>
      error === undefined ? resolve() : reject(error),
    );
  });
}
