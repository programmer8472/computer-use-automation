import {
  CapabilityPackageSchema,
  type Action,
  type TargetLocator,
} from "@computer-use/contracts";
import type { DiscoveryTrace } from "@computer-use/discovery";
import { describe, expect, it } from "vitest";

import {
  approveCapability,
  verifyApprovedCapability,
} from "../src/approval.js";
import { compileContactUpdateCapability } from "../src/compiler.js";

describe("capability compiler and approval", () => {
  it("compiles reviewed mechanics into a readable draft capability", () => {
    const draft = compile();

    expect(CapabilityPackageSchema.parse(draft)).toEqual(draft);
    expect(draft.approval).toEqual({ status: "draft" });
    expect(draft.provenance).toEqual({
      discoveryRunId: "run-compiler-test",
      evidenceRefs: ["evidence/generated/run-compiler-test/manifest.json"],
      modelCallCount: 5,
    });
    expect(draft.policy.allowedActions).toEqual(["click", "fill"]);
    const firstAction = draft.steps[0]?.action;
    expect(firstAction?.type).toBe("click");
    if (firstAction?.type !== "click") throw new Error("Expected click step");
    expect(firstAction.target.strategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "role",
          role: "link",
          name: "{memberId}",
        }),
        expect.objectContaining({
          type: "role",
          role: "link",
          name: "View contact {memberId}",
        }),
      ]),
    );
    expect(draft.steps[3]).toMatchObject({
      effect: "write",
      retry: { mode: "reconcile_only", maxAttempts: 1 },
    });
  });

  it("binds approval to capability content and reviewer metadata", () => {
    const draft = compile();
    expect(verifyApprovedCapability(draft)).toEqual({
      valid: false,
      reason: "Capability is not approved",
    });

    const approved = approveCapability(
      draft,
      "reviewer@example.test",
      new Date("2026-09-25T18:00:00.000Z"),
    );
    expect(verifyApprovedCapability(approved).valid).toBe(true);

    const modified = structuredClone(approved);
    modified.steps[2]!.description = "Broadened after approval";
    expect(verifyApprovedCapability(modified)).toEqual({
      valid: false,
      reason: "Capability content no longer matches its approval digest",
    });

    const reviewerModified = structuredClone(approved);
    if (reviewerModified.approval.status !== "approved") {
      throw new Error("Expected approved fixture");
    }
    reviewerModified.approval.approvedBy = "someone-else@example.test";
    expect(verifyApprovedCapability(reviewerModified).valid).toBe(false);
  });

  it("rejects mechanics outside the reviewed workflow shape", () => {
    const trace = traceFixture();
    trace.steps.pop();

    expect(() => compileWithTrace(trace)).toThrow(
      "requires click, click, fill, click mechanics",
    );
  });
});

function compile() {
  return compileWithTrace(traceFixture());
}

function compileWithTrace(trace: DiscoveryTrace) {
  return compileContactUpdateCapability(trace, {
    allowedOrigin: "http://127.0.0.1:4173",
    evidenceManifestRef: "evidence/generated/run-compiler-test/manifest.json",
    reviewedPolicy: {
      allowedOrigins: ["http://127.0.0.1:4173"],
      allowedRoutes: ["/contacts", "/contacts/*"],
      allowedActions: ["navigate", "click", "fill", "human_control"],
      blockedDataClasses: ["credential", "full_ssn"],
      maximumRecoveryAttempts: 1,
      requiredApprovals: [
        { risk: "high", authority: "human_operator" },
        { risk: "critical", authority: "human_operator" },
      ],
    },
  });
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
    runId: "run-compiler-test",
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
