import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0" as const;

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/);

const nonEmptyText = z.string().trim().min(1);
const isoTimestamp = z.string().datetime({ offset: true });
const sha256Digest = z.string().regex(/^[a-f0-9]{64}$/);

export const DataClassSchema = z.enum([
  "public",
  "personal",
  "sensitive",
  "credential",
  "full_ssn",
]);

const commonValueDefinition = {
  description: nonEmptyText,
  required: z.boolean(),
  dataClass: DataClassSchema,
};

export const ValueDefinitionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...commonValueDefinition,
    type: z.literal("string"),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    pattern: z.string().min(1).optional(),
  }),
  z.strictObject({
    ...commonValueDefinition,
    type: z.literal("number"),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  z.strictObject({
    ...commonValueDefinition,
    type: z.literal("boolean"),
  }),
  z.strictObject({
    ...commonValueDefinition,
    type: z.literal("enum"),
    values: z.array(nonEmptyText).min(1),
  }),
]);

export const LocatorStrategySchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("role"),
    role: nonEmptyText,
    name: nonEmptyText,
    exact: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("label"),
    label: nonEmptyText,
    exact: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("text"),
    text: nonEmptyText,
    exact: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("css"),
    selector: nonEmptyText,
    scope: nonEmptyText.optional(),
  }),
]);

export const TargetLocatorSchema = z.strictObject({
  strategies: z.array(LocatorStrategySchema).min(1).max(5),
  expectedCardinality: z.literal(1),
  context: z
    .strictObject({
      frameName: nonEmptyText.optional(),
      ancestorRole: nonEmptyText.optional(),
      ancestorName: nonEmptyText.optional(),
    })
    .optional(),
  rationale: nonEmptyText,
});

export const ValueSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("input"),
    name: identifier,
  }),
  z.strictObject({
    kind: z.literal("literal"),
    value: z.union([z.string(), z.number(), z.boolean()]),
    dataClass: z.literal("public"),
  }),
]);

export const ActionTypeSchema = z.enum([
  "navigate",
  "click",
  "fill",
  "select",
  "capture",
  "human_control",
]);

export const ActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("navigate"),
    urlTemplate: nonEmptyText,
  }),
  z.strictObject({
    type: z.literal("click"),
    target: TargetLocatorSchema,
  }),
  z.strictObject({
    type: z.literal("fill"),
    target: TargetLocatorSchema,
    value: ValueSourceSchema,
  }),
  z.strictObject({
    type: z.literal("select"),
    target: TargetLocatorSchema,
    value: ValueSourceSchema,
  }),
  z.strictObject({
    type: z.literal("capture"),
    target: TargetLocatorSchema,
    output: identifier,
  }),
  z.strictObject({
    type: z.literal("human_control"),
    reasonCode: identifier,
  }),
]);

export const CheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("element"),
    target: TargetLocatorSchema,
    state: z.enum(["visible", "hidden", "enabled", "disabled"]),
  }),
  z.strictObject({
    kind: z.literal("url"),
    pattern: nonEmptyText,
  }),
  z.strictObject({
    kind: z.literal("marker"),
    name: identifier,
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
]);

export const RetryPolicySchema = z.strictObject({
  mode: z.enum(["none", "safe_retry", "reconcile_only"]),
  maxAttempts: z.number().int().min(1).max(3),
  backoffMs: z.number().int().min(0).max(10_000),
});

export const StepSchema = z
  .strictObject({
    id: identifier,
    description: nonEmptyText,
    action: ActionSchema,
    preconditions: z.array(CheckSchema),
    settleConditions: z.array(CheckSchema).min(1),
    postconditions: z.array(CheckSchema).min(1),
    timeoutMs: z.number().int().min(100).max(60_000),
    effect: z.enum(["none", "read", "write", "irreversible"]),
    risk: z.enum(["low", "medium", "high", "critical"]),
    retry: RetryPolicySchema,
  })
  .superRefine((step, context) => {
    const hasExternalEffect =
      step.effect === "write" || step.effect === "irreversible";

    if (hasExternalEffect && step.retry.mode === "safe_retry") {
      context.addIssue({
        code: "custom",
        path: ["retry", "mode"],
        message: "External-effecting actions cannot use blind safe retries",
      });
    }

    if (hasExternalEffect && step.retry.maxAttempts !== 1) {
      context.addIssue({
        code: "custom",
        path: ["retry", "maxAttempts"],
        message: "External-effecting actions must execute at most once",
      });
    }

    if (step.effect === "irreversible" && step.risk !== "critical") {
      context.addIssue({
        code: "custom",
        path: ["risk"],
        message: "Irreversible actions must be classified as critical risk",
      });
    }
  });

const origin = z
  .string()
  .url()
  .refine(
    (value) => {
      const parsed = new URL(value);
      return (
        parsed.href === `${parsed.origin}/` || parsed.href === parsed.origin
      );
    },
    { message: "Allowed origins cannot include a path, query, or fragment" },
  );

export const ExecutionPolicySchema = z.strictObject({
  allowedOrigins: z.array(origin).min(1),
  allowedRoutes: z.array(nonEmptyText).min(1),
  allowedActions: z.array(ActionTypeSchema).min(1),
  blockedDataClasses: z.array(DataClassSchema),
  maximumRecoveryAttempts: z.number().int().min(0).max(3),
  requiredApprovals: z.array(
    z.strictObject({
      risk: z.enum(["high", "critical"]),
      authority: z.enum(["human_operator", "institution_policy"]),
    }),
  ),
});

const OutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("success"),
    code: z.literal("SUCCESS"),
    finalChecks: z.array(CheckSchema).min(1),
    outputBindings: z.record(identifier, identifier),
  }),
  z.strictObject({
    kind: z.literal("business_outcome"),
    code: identifier.refine((value) => value !== "SUCCESS"),
    conditions: z.array(CheckSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("pending_escalation"),
    code: identifier,
    conditions: z.array(CheckSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("hard_failure"),
    code: identifier,
    conditions: z.array(CheckSchema).min(1),
  }),
]);

const ApprovalSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("draft"),
  }),
  z.strictObject({
    status: z.literal("approved"),
    approvedBy: nonEmptyText,
    approvedAt: isoTimestamp,
    digest: sha256Digest,
  }),
  z.strictObject({
    status: z.literal("revoked"),
    revokedBy: nonEmptyText,
    revokedAt: isoTimestamp,
    reason: nonEmptyText,
    digest: sha256Digest,
  }),
]);

export const CapabilityPackageSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    capability: z.strictObject({
      id: identifier,
      name: nonEmptyText,
      revision: z.number().int().positive(),
    }),
    approval: ApprovalSchema,
    target: z.strictObject({
      appFamily: identifier,
      surface: z.enum(["web", "legacy_web", "desktop"]),
      semanticVersionRange: nonEmptyText,
      responsiveVariants: z.array(identifier).min(1),
    }),
    inputs: z.record(identifier, ValueDefinitionSchema),
    outputs: z.record(identifier, ValueDefinitionSchema),
    steps: z.array(StepSchema).min(1),
    outcomes: z.array(OutcomeSchema).min(1),
    policy: ExecutionPolicySchema,
    provenance: z.strictObject({
      discoveryRunId: identifier,
      evidenceRefs: z.array(nonEmptyText).min(1),
      modelCallCount: z.number().int().positive(),
    }),
  })
  .superRefine((capabilityPackage, context) => {
    const successOutcomes = capabilityPackage.outcomes.filter(
      (outcome) => outcome.kind === "success",
    );

    if (successOutcomes.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["outcomes"],
        message: "A capability must declare exactly one success outcome",
      });
    }

    const stepIds = capabilityPackage.steps.map((step) => step.id);
    if (new Set(stepIds).size !== stepIds.length) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Step identifiers must be unique",
      });
    }

    const outcomeCodes = capabilityPackage.outcomes.map(
      (outcome) => outcome.code,
    );
    if (new Set(outcomeCodes).size !== outcomeCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["outcomes"],
        message: "Outcome codes must be unique",
      });
    }

    for (const [index, step] of capabilityPackage.steps.entries()) {
      if (
        (step.action.type === "fill" || step.action.type === "select") &&
        step.action.value.kind === "input" &&
        !(step.action.value.name in capabilityPackage.inputs)
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "action", "value", "name"],
          message: "Action references an undeclared capability input",
        });
      }
    }

    for (const success of successOutcomes) {
      for (const outputName of Object.keys(success.outputBindings)) {
        if (!(outputName in capabilityPackage.outputs)) {
          context.addIssue({
            code: "custom",
            path: ["outcomes"],
            message: "Success outcome binds an undeclared output",
          });
        }
      }
    }
  });

const eventBase = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  eventId: identifier,
  runId: identifier,
  sequence: z.number().int().nonnegative(),
  timestamp: isoTimestamp,
};

export const EvidenceEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...eventBase,
    type: z.literal("run_started"),
    capabilityId: identifier.optional(),
    mode: z.enum(["discovery", "replay"]),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("observation"),
    stepId: identifier.optional(),
    stateDigest: sha256Digest,
    redactedArtifactRef: nonEmptyText,
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("action"),
    stepId: identifier,
    actionType: ActionTypeSchema,
    outcome: z.enum(["attempted", "completed", "blocked"]),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("intervention"),
    interventionId: identifier,
    status: z.enum(["requested", "claimed", "released", "resumed"]),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal("run_completed"),
    resultKind: z.enum([
      "success",
      "business_outcome",
      "pending_escalation",
      "hard_failure",
    ]),
    modelCallCount: z.number().int().nonnegative(),
  }),
]);

export const InterventionRequestSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  interventionId: identifier,
  runId: identifier,
  capabilityId: identifier,
  stepId: identifier,
  status: z.enum(["requested", "claimed", "released", "resumed", "cancelled"]),
  leaseOwner: z.enum(["automation", "released", "operator"]),
  reasonCode: identifier,
  reason: nonEmptyText,
  redactedContext: z.record(identifier, z.string()),
  requiredResumeChecks: z.array(CheckSchema).min(1),
  createdAt: isoTimestamp,
});

const resultBase = {
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: identifier,
  capabilityId: identifier,
  evidenceRefs: z.array(nonEmptyText),
  completedAt: isoTimestamp,
};

export const TerminalResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...resultBase,
    kind: z.literal("success"),
    code: z.literal("SUCCESS"),
    outputs: z.record(identifier, z.unknown()),
  }),
  z.strictObject({
    ...resultBase,
    kind: z.literal("business_outcome"),
    code: identifier,
    details: z.record(identifier, z.string()),
  }),
  z.strictObject({
    ...resultBase,
    kind: z.literal("pending_escalation"),
    code: identifier,
    interventionId: identifier,
    reason: nonEmptyText,
  }),
  z.strictObject({
    ...resultBase,
    kind: z.literal("hard_failure"),
    code: identifier,
    stepId: identifier.optional(),
    expected: nonEmptyText,
    observed: nonEmptyText,
  }),
]);

export type CapabilityPackage = z.infer<typeof CapabilityPackageSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;
export type InterventionRequest = z.infer<typeof InterventionRequestSchema>;
export type Step = z.infer<typeof StepSchema>;
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;
export type TargetLocator = z.infer<typeof TargetLocatorSchema>;
export type TerminalResult = z.infer<typeof TerminalResultSchema>;
export type ValueSource = z.infer<typeof ValueSourceSchema>;
