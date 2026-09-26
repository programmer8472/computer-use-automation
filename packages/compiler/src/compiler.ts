import {
  CapabilityPackageSchema,
  SCHEMA_VERSION,
  type Action,
  type CapabilityPackage,
  type Check,
  type ExecutionPolicy,
  type Step,
  type TargetLocator,
} from "@computer-use/contracts";
import type { DiscoveryTrace } from "@computer-use/discovery";

export interface ContactUpdateCompilerOptions {
  allowedOrigin: string;
  evidenceManifestRef: string;
  reviewedPolicy: ExecutionPolicy;
}

const updatedNoticeTarget: TargetLocator = {
  strategies: [{ type: "text", text: "Contact updated.", exact: true }],
  expectedCardinality: 1,
  rationale: "The target application emits this reviewed success notice",
};

export function compileContactUpdateCapability(
  trace: DiscoveryTrace,
  options: ContactUpdateCompilerOptions,
): CapabilityPackage {
  if (trace.modelCallCount < 1) {
    throw new Error("A compiled capability requires genuine model provenance");
  }
  if (trace.steps.length < 1) {
    throw new Error("The discovery trace contains no mechanical steps");
  }

  const actions = trace.steps.map((recordedStep) => recordedStep.action);
  assertExpectedContactUpdateShape(actions);
  const compiledActions = actions.map((action, index) =>
    index === 0 ? bindMemberIdentifier(action) : structuredClone(action),
  );
  const discoveredActionTypes = new Set(
    compiledActions.map((action) => action.type),
  );
  const effectiveAllowedActions = options.reviewedPolicy.allowedActions.filter(
    (actionType) => discoveredActionTypes.has(actionType),
  );

  const memberTarget = targetFor(compiledActions[0]);
  const steps = compiledActions.map((action, index) =>
    compileStep(trace.steps[index]?.id ?? `step-${index + 1}`, action, index),
  );

  return CapabilityPackageSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    capability: {
      id: "contact.update-phone",
      name: "Update a member phone number",
      revision: 1,
    },
    approval: { status: "draft" },
    target: {
      appFamily: "member-contacts",
      surface: "legacy_web",
      semanticVersionRange: ">=1.0.0 <2.0.0",
      responsiveVariants: ["wide", "tablet", "narrow"],
    },
    inputs: {
      memberId: {
        type: "string",
        description: "Synthetic member identifier",
        required: true,
        dataClass: "personal",
        minLength: 6,
        maxLength: 6,
        pattern: "^M-[0-9]{4}$",
      },
      phone: {
        type: "string",
        description: "Replacement synthetic phone number",
        required: true,
        dataClass: "personal",
        minLength: 7,
        maxLength: 20,
      },
    },
    outputs: {
      updated: {
        type: "boolean",
        description: "Whether the update was independently verified",
        required: true,
        dataClass: "public",
      },
    },
    steps,
    outcomes: [
      {
        kind: "success",
        code: "SUCCESS",
        finalChecks: [elementCheck(updatedNoticeTarget, "visible")],
        outputBindings: { updated: "contact-updated" },
      },
      {
        kind: "business_outcome",
        code: "CONTACT_NOT_FOUND",
        conditions: [elementCheck(memberTarget, "hidden")],
      },
      {
        kind: "hard_failure",
        code: "AMBIGUOUS_TARGET",
        conditions: [{ kind: "marker", name: "target-ambiguous", value: true }],
      },
    ],
    policy: {
      ...structuredClone(options.reviewedPolicy),
      allowedOrigins: [options.allowedOrigin],
      allowedActions: effectiveAllowedActions,
    },
    provenance: {
      discoveryRunId: trace.runId,
      evidenceRefs: [options.evidenceManifestRef],
      modelCallCount: trace.modelCallCount,
    },
  });
}

function assertExpectedContactUpdateShape(actions: Action[]): void {
  const expected = ["click", "click", "fill", "click"];
  if (
    actions.length !== expected.length ||
    actions.some((action, index) => action.type !== expected[index])
  ) {
    throw new Error(
      "The reviewed contact-update catalog requires click, click, fill, click mechanics",
    );
  }
  const fill = actions[2];
  if (
    fill?.type !== "fill" ||
    fill.value.kind !== "input" ||
    fill.value.name !== "phone"
  ) {
    throw new Error(
      "The reviewed contact-update fill must bind the phone input",
    );
  }
}

function bindMemberIdentifier(action: Action): Action {
  if (action.type !== "click") {
    throw new Error("The first contact-update action must select a member");
  }
  const target = structuredClone(action.target);
  const first = target.strategies[0];
  if (first?.type !== "role" || first.role !== "link") {
    throw new Error("Member selection must use an accessible link target");
  }
  first.name = "{memberId}";
  target.rationale =
    "Reviewed member link whose accessible name is bound to memberId";
  return { type: "click", target };
}

function compileStep(id: string, action: Action, index: number): Step {
  const target = targetFor(action);
  const isWrite = index === 3;
  const completionCheck = completionCheckFor(index, target);
  return {
    id,
    description: descriptionFor(index),
    action,
    preconditions: [
      elementCheck(target, action.type === "click" ? "enabled" : "visible"),
    ],
    settleConditions: [completionCheck],
    postconditions: [completionCheck],
    timeoutMs: isWrite ? 10_000 : 5_000,
    effect: isWrite ? "write" : "none",
    risk: isWrite ? "medium" : "low",
    retry: isWrite
      ? { mode: "reconcile_only", maxAttempts: 1, backoffMs: 0 }
      : { mode: "safe_retry", maxAttempts: 2, backoffMs: 100 },
  };
}

function completionCheckFor(index: number, target: TargetLocator): Check {
  if (index === 0) return { kind: "url", pattern: "/contacts/*" };
  if (index === 1) return { kind: "url", pattern: "/contacts/*/edit" };
  if (index === 3) return elementCheck(updatedNoticeTarget, "visible");
  return elementCheck(target, "visible");
}

function descriptionFor(index: number): string {
  return (
    [
      "Select the requested member",
      "Open the member edit form",
      "Fill the replacement phone number",
      "Persist the member update once",
    ][index] ?? `Execute discovered step ${index + 1}`
  );
}

function targetFor(action: Action | undefined): TargetLocator {
  if (
    action?.type === "click" ||
    action?.type === "fill" ||
    action?.type === "select" ||
    action?.type === "capture"
  ) {
    return action.target;
  }
  throw new Error(`Action ${action?.type ?? "missing"} has no semantic target`);
}

function elementCheck(
  target: TargetLocator,
  state: "visible" | "hidden" | "enabled" | "disabled",
): Check {
  return { kind: "element", target: structuredClone(target), state };
}
