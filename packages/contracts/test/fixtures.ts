const searchInputTarget = {
  strategies: [{ type: "label", label: "Member search", exact: true }],
  expectedCardinality: 1,
  rationale: "The search field has a stable accessible label",
};

const phoneInputTarget = {
  strategies: [{ type: "label", label: "Phone", exact: true }],
  expectedCardinality: 1,
  context: { ancestorRole: "form", ancestorName: "Edit member" },
  rationale: "The phone input is scoped to the selected member form",
};

const saveButtonTarget = {
  strategies: [
    { type: "role", role: "button", name: "Save changes", exact: true },
  ],
  expectedCardinality: 1,
  context: { ancestorRole: "form", ancestorName: "Edit member" },
  rationale: "The save button is uniquely named inside the edit form",
};

export const validCapabilityFixture: unknown = {
  schemaVersion: "1.0.0",
  capability: {
    id: "contact.update-phone",
    name: "Update a member phone number",
    revision: 1,
  },
  approval: {
    status: "approved",
    approvedBy: "reviewer@example.test",
    approvedAt: "2026-09-25T18:00:00Z",
    digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
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
      minLength: 1,
      maxLength: 32,
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
      description: "Whether the update was verified",
      required: true,
      dataClass: "public",
    },
  },
  steps: [
    {
      id: "search-member",
      description: "Search for the requested member",
      action: {
        type: "fill",
        target: searchInputTarget,
        value: { kind: "input", name: "memberId" },
      },
      preconditions: [
        { kind: "element", target: searchInputTarget, state: "visible" },
      ],
      settleConditions: [
        { kind: "marker", name: "search-settled", value: true },
      ],
      postconditions: [
        { kind: "marker", name: "search-value-bound", value: true },
      ],
      timeoutMs: 5000,
      effect: "none",
      risk: "low",
      retry: { mode: "safe_retry", maxAttempts: 2, backoffMs: 100 },
    },
    {
      id: "fill-phone",
      description: "Fill the replacement phone number",
      action: {
        type: "fill",
        target: phoneInputTarget,
        value: { kind: "input", name: "phone" },
      },
      preconditions: [
        { kind: "element", target: phoneInputTarget, state: "visible" },
      ],
      settleConditions: [
        { kind: "marker", name: "phone-value-settled", value: true },
      ],
      postconditions: [
        { kind: "marker", name: "phone-value-bound", value: true },
      ],
      timeoutMs: 5000,
      effect: "none",
      risk: "low",
      retry: { mode: "safe_retry", maxAttempts: 2, backoffMs: 100 },
    },
    {
      id: "save-member",
      description: "Persist the member update once",
      action: { type: "click", target: saveButtonTarget },
      preconditions: [
        { kind: "element", target: saveButtonTarget, state: "enabled" },
      ],
      settleConditions: [{ kind: "marker", name: "save-settled", value: true }],
      postconditions: [
        { kind: "marker", name: "contact-updated", value: true },
      ],
      timeoutMs: 10000,
      effect: "write",
      risk: "medium",
      retry: { mode: "reconcile_only", maxAttempts: 1, backoffMs: 0 },
    },
  ],
  outcomes: [
    {
      kind: "success",
      code: "SUCCESS",
      finalChecks: [{ kind: "marker", name: "contact-updated", value: true }],
      outputBindings: { updated: "contact-updated" },
    },
    {
      kind: "business_outcome",
      code: "CONTACT_NOT_FOUND",
      conditions: [{ kind: "marker", name: "contact-not-found", value: true }],
    },
    {
      kind: "hard_failure",
      code: "AMBIGUOUS_TARGET",
      conditions: [{ kind: "marker", name: "target-ambiguous", value: true }],
    },
  ],
  policy: {
    allowedOrigins: ["http://127.0.0.1:4173"],
    allowedRoutes: ["/contacts", "/contacts/*"],
    allowedActions: ["navigate", "click", "fill", "capture", "human_control"],
    blockedDataClasses: ["credential", "full_ssn"],
    maximumRecoveryAttempts: 2,
    requiredApprovals: [
      { risk: "high", authority: "human_operator" },
      { risk: "critical", authority: "human_operator" },
    ],
  },
  provenance: {
    discoveryRunId: "discovery-run-001",
    evidenceRefs: ["evidence/discovery-run-001/manifest.json"],
    modelCallCount: 4,
  },
};

function copyFixture(): Record<string, unknown> {
  return structuredClone(validCapabilityFixture) as Record<string, unknown>;
}

export function missingVersionFixture(): unknown {
  const fixture = copyFixture();
  delete fixture.schemaVersion;
  return fixture;
}

export function unknownActionFixture(): unknown {
  const fixture = copyFixture();
  const steps = fixture.steps as Array<Record<string, unknown>>;
  steps[0] = {
    ...steps[0],
    action: { type: "drag", from: "search", to: "results" },
  };
  return fixture;
}

export function ambiguousSuccessFixture(): unknown {
  const fixture = copyFixture();
  const outcomes = fixture.outcomes as Array<Record<string, unknown>>;
  outcomes.push({
    kind: "success",
    code: "SUCCESS",
    finalChecks: [{ kind: "marker", name: "duplicate-success", value: true }],
    outputBindings: { updated: "duplicate-success" },
  });
  return fixture;
}

export function unsafeRetryFixture(): unknown {
  const fixture = copyFixture();
  const steps = fixture.steps as Array<Record<string, unknown>>;
  const saveStep = steps[2];
  if (saveStep === undefined) {
    throw new Error("Expected the save step fixture");
  }
  saveStep.retry = { mode: "safe_retry", maxAttempts: 2, backoffMs: 100 };
  return fixture;
}
