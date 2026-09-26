import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createContactsApp } from "../../../apps/contacts/src/app.js";
import { MemberRepository } from "../../../apps/contacts/src/repository.js";
import {
  approveCapability,
  compileContactUpdateCapability,
} from "@computer-use/compiler";
import type {
  Action,
  Check,
  ExecutionPolicy,
  TargetLocator,
} from "@computer-use/contracts";
import type { DiscoveryTrace } from "@computer-use/discovery";
import { EvidencePackageWriter, PrivacyGateway } from "@computer-use/evidence";
import {
  PlaywrightSurfaceAdapter,
  type ActionResult,
  type SurfaceObservation,
  type SurfaceTargetInspection,
} from "@computer-use/surface-playwright";
import { chromium, type Browser, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReplayExecutor } from "../src/executor.js";
import type { ReplaySurface } from "../src/types.js";

describe("deterministic replay", () => {
  let server: Server;
  let browser: Browser;
  let page: Page;
  let repository: MemberRepository;
  let baseUrl: string;
  let evidenceRoot: string;

  beforeEach(async () => {
    repository = new MemberRepository();
    server = createContactsApp({ repository }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    evidenceRoot = await mkdtemp(join(tmpdir(), "replay-evidence-"));
  });

  afterEach(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  it("replays an approved capability with changed inputs and zero model calls", async () => {
    const capability = approvedCapability();
    const executor = new ReplayExecutor({
      surface: adapter(),
      runtimePolicy: policy(),
      evidence: evidence("replay-success"),
      now: () => new Date("2026-09-26T12:00:00.000Z"),
    });

    const result = await executor.run({
      runId: "replay-success",
      capability,
      inputs: { memberId: "M-1002", phone: "555-0299" },
      startUrl: `${baseUrl}/contacts`,
    });

    expect(result).toMatchObject({
      kind: "success",
      code: "SUCCESS",
      outputs: { updated: true },
    });
    expect(repository.get("M-1002")?.phone).toBe("555-0299");
    const events = await readFile(join(evidenceRoot, "events.jsonl"), "utf8");
    expect(events).toContain('"modelCallCount":0');
    expect(events).not.toContain("555-0299");
  });

  it("rejects unapproved and modified artifacts before browser use", async () => {
    const trackingSurface = new TrackingSurface(adapter());
    const executor = new ReplayExecutor({
      surface: trackingSurface,
      runtimePolicy: policy(),
    });
    const draft = draftCapability();

    const unapproved = await executor.run({
      runId: "replay-unapproved",
      capability: draft,
      inputs: { memberId: "M-1001", phone: "555-0298" },
      startUrl: `${baseUrl}/contacts`,
    });
    expect(unapproved).toMatchObject({
      kind: "hard_failure",
      code: "CAPABILITY_NOT_APPROVED",
    });
    expect(trackingSurface.actionCount).toBe(0);

    const modified = structuredClone(approvedCapability());
    modified.steps[2]!.description = "Modified after approval";
    const tampered = await new ReplayExecutor({
      surface: trackingSurface,
      runtimePolicy: policy(),
    }).run({
      runId: "replay-modified",
      capability: modified,
      inputs: { memberId: "M-1001", phone: "555-0298" },
      startUrl: `${baseUrl}/contacts`,
    });
    expect(tampered).toMatchObject({
      kind: "hard_failure",
      code: "CAPABILITY_NOT_APPROVED",
    });
    expect(trackingSurface.actionCount).toBe(0);
  });

  it("reconciles a timeout after a write without repeating the write", async () => {
    const trackingSurface = new TrackingSurface(adapter(), true);
    const executor = new ReplayExecutor({
      surface: trackingSurface,
      runtimePolicy: policy(),
    });

    const result = await executor.run({
      runId: "replay-reconcile",
      capability: approvedCapability(),
      inputs: { memberId: "M-1003", phone: "555-0399" },
      startUrl: `${baseUrl}/contacts`,
    });

    expect(result.kind).toBe("success");
    expect(repository.get("M-1003")?.phone).toBe("555-0399");
    expect(trackingSurface.writeCount).toBe(1);
  });

  it("blocks an approved capability repointed to the visible SSN control", async () => {
    const draft = draftCapability();
    const fillStep = draft.steps[2];
    if (fillStep?.action.type !== "fill") {
      throw new Error("Expected the reviewed fill step");
    }
    fillStep.action.target = {
      strategies: [
        {
          type: "label",
          label: "Social Security number (human entry only)",
          exact: true,
        },
      ],
      expectedCardinality: 1,
      rationale: "Deliberately sensitive test target",
    };
    const capability = approveCapability(
      draft,
      "reviewer@example.test",
      new Date("2026-09-26T11:00:00.000Z"),
    );
    const trackingSurface = new TrackingSurface(adapter());

    const result = await new ReplayExecutor({
      surface: trackingSurface,
      runtimePolicy: policy(),
    }).run({
      runId: "replay-sensitive-target",
      capability,
      inputs: { memberId: "M-1001", phone: "555-0297" },
      startUrl: `${baseUrl}/contacts`,
    });

    expect(result).toMatchObject({
      kind: "hard_failure",
      code: "SENSITIVE_CONTROL_BLOCKED",
    });
    expect(repository.get("M-1001")).toMatchObject({
      phone: "555-0101",
      ssnOnFile: false,
    });
  });

  function adapter(): PlaywrightSurfaceAdapter {
    return new PlaywrightSurfaceAdapter(page, {
      allowedOrigins: [baseUrl],
      allowedRoutes: ["/contacts", "/contacts/*"],
    });
  }

  function evidence(runId: string): EvidencePackageWriter {
    return new EvidencePackageWriter(evidenceRoot, runId, {
      privacyGateway: new PrivacyGateway({ redactEmails: true }),
      now: () => new Date("2026-09-26T12:00:00.000Z"),
    });
  }

  function policy(): ExecutionPolicy {
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

  function draftCapability() {
    return compileContactUpdateCapability(traceFixture(), {
      allowedOrigin: baseUrl,
      evidenceManifestRef: "evidence/discovery/manifest.json",
      reviewedPolicy: policy(),
    });
  }

  function approvedCapability() {
    return approveCapability(
      draftCapability(),
      "reviewer@example.test",
      new Date("2026-09-26T11:00:00.000Z"),
    );
  }
});

class TrackingSurface implements ReplaySurface {
  actionCount = 0;
  writeCount = 0;
  #settleCount = 0;

  constructor(
    readonly delegate: PlaywrightSurfaceAdapter,
    readonly failWriteSettle = false,
  ) {}

  async act(
    action: Action,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<ActionResult> {
    this.actionCount += 1;
    if (
      action.type === "click" &&
      action.target.strategies.some(
        (strategy) =>
          strategy.type === "role" && strategy.name === "Save changes",
      )
    ) {
      this.writeCount += 1;
    }
    return this.delegate.act(action, inputs);
  }

  check(check: Check): Promise<boolean> {
    return this.delegate.check(check);
  }

  async settle(checks: readonly Check[], timeoutMs: number): Promise<void> {
    this.#settleCount += 1;
    if (this.failWriteSettle && this.#settleCount === 4) {
      throw new Error("Synthetic timeout after the write completed");
    }
    await this.delegate.settle(checks, timeoutMs);
  }

  observe(): Promise<SurfaceObservation> {
    return this.delegate.observe();
  }

  inspectTarget(target: TargetLocator): Promise<SurfaceTargetInspection> {
    return this.delegate.inspectTarget(target);
  }

  assertUrlAllowed(value: string): void {
    this.delegate.assertUrlAllowed(value);
  }
}

function traceFixture(): DiscoveryTrace {
  const actions: Action[] = [
    click("link", "M-1001"),
    click("link", "Edit contact"),
    {
      type: "fill",
      target: target("label", "Phone"),
      value: { kind: "input", name: "phone" },
    },
    click("button", "Save changes"),
  ];
  return {
    schemaVersion: "1.0.0",
    runId: "discovery-replay-test",
    goal: "Update the member phone number",
    modelCallCount: 5,
    steps: actions.map((action, index) => ({
      id: `step-${index + 1}`,
      observationBeforeRef: `observations/before-${index + 1}.json`,
      observationBeforeDigest: "a".repeat(64),
      action,
      resolvedStrategyIndex: 0,
      observationAfterRef: `observations/after-${index + 1}.json`,
      observationAfterDigest: "b".repeat(64),
    })),
  };
}

function click(role: "button" | "link", name: string): Action {
  return { type: "click", target: target("role", name, role) };
}

function target(
  kind: "role" | "label",
  name: string,
  role: "button" | "link" = "button",
): TargetLocator {
  return {
    strategies:
      kind === "role"
        ? [{ type: "role", role, name, exact: true }]
        : [{ type: "label", label: name, exact: true }],
    expectedCardinality: 1,
    rationale: "Observed semantic target",
  };
}
