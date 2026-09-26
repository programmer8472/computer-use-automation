import type { Action, ExecutionPolicy } from "@computer-use/contracts";
import { describe, expect, it } from "vitest";

import {
  authorizeResolvedAction,
  intersectPolicies,
  type PolicyDeniedError,
  type ResolvedControlFacts,
} from "../src/index.js";

describe("effective runtime authority", () => {
  it("intersects grants while unioning restrictions", () => {
    const artifact = policy({
      origins: ["http://127.0.0.1:4173", "https://artifact.example"],
      routes: ["/contacts", "/contacts/*", "/artifact-only"],
      actions: ["click", "fill", "capture"],
      blocked: ["credential"],
      recovery: 2,
    });
    const runtime = policy({
      origins: ["http://127.0.0.1:4173", "https://runtime.example"],
      routes: ["/contacts", "/contacts/*", "/runtime-only"],
      actions: ["click", "fill", "human_control"],
      blocked: ["full_ssn"],
      recovery: 1,
    });

    const effective = intersectPolicies(artifact, runtime);

    expect(effective.allowedOrigins).toEqual(["http://127.0.0.1:4173"]);
    expect(effective.allowedRoutes).toEqual(["/contacts", "/contacts/*"]);
    expect(effective.allowedActions).toEqual(["click", "fill"]);
    expect(effective.blockedDataClasses).toEqual(["credential", "full_ssn"]);
    expect(effective.maximumRecoveryAttempts).toBe(1);
  });

  it("blocks sensitive controls even when fill is otherwise allowed", () => {
    const action: Action = {
      type: "fill",
      target: target("Social Security number (human entry only)"),
      value: { kind: "input", name: "phone" },
    };
    const facts: ResolvedControlFacts = {
      target: action.target,
      strategyIndex: 0,
      tag: "input",
      role: "textbox",
      name: "Social Security number (human entry only)",
      inputType: "password",
      href: undefined,
    };

    expect(() => authorizeResolvedAction(action, facts, policy())).toThrowError(
      expect.objectContaining<Partial<PolicyDeniedError>>({
        code: "SENSITIVE_CONTROL_BLOCKED",
      }),
    );
  });

  it("blocks a resolved link whose destination is outside effective routes", () => {
    const action: Action = { type: "click", target: target("Admin") };
    const facts: ResolvedControlFacts = {
      target: action.target,
      strategyIndex: 0,
      tag: "a",
      role: "link",
      name: "Admin",
      inputType: undefined,
      href: "http://127.0.0.1:4173/admin/scenarios",
    };

    expect(() => authorizeResolvedAction(action, facts, policy())).toThrowError(
      expect.objectContaining<Partial<PolicyDeniedError>>({
        code: "ROUTE_NOT_ALLOWED",
      }),
    );
  });
});

function policy(
  overrides: {
    origins?: string[];
    routes?: string[];
    actions?: ExecutionPolicy["allowedActions"];
    blocked?: ExecutionPolicy["blockedDataClasses"];
    recovery?: number;
  } = {},
): ExecutionPolicy {
  return {
    allowedOrigins: overrides.origins ?? ["http://127.0.0.1:4173"],
    allowedRoutes: overrides.routes ?? ["/contacts", "/contacts/*"],
    allowedActions: overrides.actions ?? ["click", "fill"],
    blockedDataClasses: overrides.blocked ?? ["credential", "full_ssn"],
    maximumRecoveryAttempts: overrides.recovery ?? 1,
    requiredApprovals: [
      { risk: "high", authority: "human_operator" },
      { risk: "critical", authority: "human_operator" },
    ],
  };
}

function target(label: string) {
  return {
    strategies: [{ type: "label" as const, label, exact: true }],
    expectedCardinality: 1 as const,
    rationale: "Reviewed target",
  };
}
