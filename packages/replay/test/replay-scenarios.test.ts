import type { Server } from "node:http";

import { createContactsApp } from "../../../apps/contacts/src/app.js";
import { MemberRepository } from "../../../apps/contacts/src/repository.js";
import { ScenarioController } from "../../../apps/contacts/src/scenarios.js";
import {
  approveCapability,
  compileContactUpdateCapability,
} from "@computer-use/compiler";
import {
  CapabilityPackageSchema,
  SCHEMA_VERSION,
  type Action,
  type Check,
  type ExecutionPolicy,
  type TargetLocator,
} from "@computer-use/contracts";
import type { DiscoveryTrace } from "@computer-use/discovery";
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

describe("responsive and exceptional replay", () => {
  let server: Server;
  let browser: Browser;
  let repository: MemberRepository;
  let scenarios: ScenarioController;
  let baseUrl: string;

  beforeEach(async () => {
    repository = new MemberRepository();
    scenarios = new ScenarioController();
    server = createContactsApp({ repository, scenarios }).listen(
      0,
      "127.0.0.1",
    );
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
  });

  afterEach(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  it("replays the same capability at wide, tablet, and narrow viewports", async () => {
    const cases = [
      { viewport: { width: 1440, height: 900 }, memberId: "M-1001" },
      { viewport: { width: 768, height: 1024 }, memberId: "M-1002" },
      { viewport: { width: 375, height: 667 }, memberId: "M-1003" },
    ];

    for (const [index, testCase] of cases.entries()) {
      const page = await browser.newPage({ viewport: testCase.viewport });
      const result = await executor(page).run({
        runId: `responsive-${index}`,
        capability: primaryCapability(),
        inputs: { memberId: testCase.memberId, phone: `555-04${index}0` },
        startUrl: `${baseUrl}/contacts`,
      });
      expect(result.kind).toBe("success");
      await page.close();
    }
  });

  it("classifies a missing member as a business outcome", async () => {
    const page = await browser.newPage();
    const result = await executor(page).run({
      runId: "missing-member",
      capability: primaryCapability(),
      inputs: { memberId: "M-9999", phone: "555-0499" },
      startUrl: `${baseUrl}/contacts`,
    });

    expect(result).toMatchObject({
      kind: "business_outcome",
      code: "CONTACT_NOT_FOUND",
    });
  });

  it("fails closed before clicking an ambiguous action", async () => {
    scenarios.set("ambiguous-actions");
    const page = await browser.newPage();
    const surface = new RecordingSurface(adapter(page));
    const result = await new ReplayExecutor({
      surface,
      runtimePolicy: policy(),
    }).run({
      runId: "ambiguous-action",
      capability: primaryCapability(),
      inputs: { memberId: "M-1001", phone: "555-0498" },
      startUrl: `${baseUrl}/contacts`,
    });

    expect(result).toMatchObject({
      kind: "hard_failure",
      code: "AMBIGUOUS_TARGET",
    });
    expect(surface.clickedNames).not.toContain("Edit contact");
    expect(repository.get("M-1001")?.phone).toBe("555-0101");
  });

  it("recovers from the real one-shot transient search failure", async () => {
    scenarios.set("transient-search");
    const page = await browser.newPage();
    const result = await new ReplayExecutor({
      surface: adapter(page),
      runtimePolicy: { ...policy(), allowedActions: ["navigate"] },
    }).run({
      runId: "transient-recovery",
      capability: transientSearchCapability(),
      inputs: {},
      startUrl: `${baseUrl}/contacts`,
    });

    expect(result.kind).toBe("success");
    expect(
      await page.getByRole("link", { name: "M-1001", exact: true }).isVisible(),
    ).toBe(true);
  });

  function executor(page: Page): ReplayExecutor {
    return new ReplayExecutor({
      surface: adapter(page),
      runtimePolicy: policy(),
    });
  }

  function adapter(page: Page): PlaywrightSurfaceAdapter {
    return new PlaywrightSurfaceAdapter(page, {
      allowedOrigins: [baseUrl],
      allowedRoutes: ["/contacts", "/contacts/*"],
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

  function primaryCapability() {
    const draft = compileContactUpdateCapability(traceFixture(), {
      allowedOrigin: baseUrl,
      evidenceManifestRef: "evidence/discovery/manifest.json",
      reviewedPolicy: policy(),
    });
    return approveCapability(
      draft,
      "reviewer@example.test",
      new Date("2026-09-26T11:00:00.000Z"),
    );
  }

  function transientSearchCapability() {
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
      policy: { ...policy(), allowedActions: ["navigate"] },
      provenance: {
        discoveryRunId: "transient-search-discovery",
        evidenceRefs: ["evidence/transient/manifest.json"],
        modelCallCount: 1,
      },
    });
    return approveCapability(
      draft,
      "reviewer@example.test",
      new Date("2026-09-26T11:00:00.000Z"),
    );
  }
});

class RecordingSurface implements ReplaySurface {
  readonly clickedNames: string[] = [];

  constructor(readonly delegate: PlaywrightSurfaceAdapter) {}

  async act(
    action: Action,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<ActionResult> {
    if (action.type === "click") {
      for (const strategy of action.target.strategies) {
        if (strategy.type === "role") this.clickedNames.push(strategy.name);
      }
    }
    return this.delegate.act(action, inputs);
  }

  check(check: Check): Promise<boolean> {
    return this.delegate.check(check);
  }

  settle(checks: readonly Check[], timeoutMs: number): Promise<void> {
    return this.delegate.settle(checks, timeoutMs);
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
    runId: "responsive-discovery",
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
