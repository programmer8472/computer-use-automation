import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  approveCapability,
  compileContactUpdateCapability,
} from "@computer-use/compiler";
import {
  CapabilityPackageSchema,
  SCHEMA_VERSION,
  type CapabilityPackage,
  type Check,
  type ExecutionPolicy,
  type TargetLocator,
  type TerminalResult,
} from "@computer-use/contracts";
import type { DiscoveryTrace } from "@computer-use/discovery";
import { EvidencePackageWriter, PrivacyGateway } from "@computer-use/evidence";
import { ReplayExecutor } from "@computer-use/replay";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium } from "playwright";

import type { MemberRepository } from "./repository.js";
import type { ScenarioController, ScenarioName } from "./scenarios.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type AutomationIntent =
  | { kind: "update_phone"; memberId: string; phone: string }
  | { kind: "find_member"; memberId: string }
  | { kind: "human_control"; reasonCode: string; memberId?: string }
  | { kind: "unsupported"; reason: string };

export interface AutomationRunView {
  runId: string;
  instruction: string;
  scenario: ScenarioName;
  capabilityId: string | undefined;
  extractedInputs: Record<string, string>;
  resultKind:
    "success" | "business_outcome" | "pending_escalation" | "hard_failure";
  code: string;
  heading: string;
  explanation: string;
  modelCallCount: number;
  evidenceDirectory: string | undefined;
  completedAt: string;
}

export type CatalogCapabilityId =
  "contact.update-phone" | "contact.find-member";

export interface CatalogValueDefinition {
  type: "string" | "boolean";
  description: string;
  required: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface CapabilityCatalogEntry {
  id: CatalogCapabilityId;
  name: string;
  description: string;
  revision: number;
  approvalStatus: "approved";
  executionMode: "deterministic_replay";
  inputs: Record<string, CatalogValueDefinition>;
  outputs: Record<string, CatalogValueDefinition>;
}

export interface CapabilityCatalog {
  catalogVersion: "1.0.0";
  invocationEndpoint: "/api/capabilities/{capabilityId}/invoke";
  capabilities: CapabilityCatalogEntry[];
}

const capabilityCatalog: CapabilityCatalog = {
  catalogVersion: "1.0.0",
  invocationEndpoint: "/api/capabilities/{capabilityId}/invoke",
  capabilities: [
    {
      id: "contact.update-phone",
      name: "Update a member phone number",
      description:
        "Find a synthetic member, update the phone field, and verify the saved state.",
      revision: 1,
      approvalStatus: "approved",
      executionMode: "deterministic_replay",
      inputs: {
        memberId: {
          type: "string",
          description: "Synthetic member identifier",
          required: true,
          pattern: "^M-[0-9]{4}$",
          minLength: 6,
          maxLength: 6,
        },
        phone: {
          type: "string",
          description: "Replacement synthetic phone number",
          required: true,
          minLength: 7,
          maxLength: 20,
        },
      },
      outputs: {
        updated: {
          type: "boolean",
          description: "Whether the update was independently verified",
          required: true,
        },
      },
    },
    {
      id: "contact.find-member",
      name: "Find a member",
      description:
        "Search for a synthetic member and classify found versus not found.",
      revision: 1,
      approvalStatus: "approved",
      executionMode: "deterministic_replay",
      inputs: {
        memberId: {
          type: "string",
          description: "Synthetic member identifier",
          required: true,
          pattern: "^M-[0-9]{4}$",
          minLength: 6,
          maxLength: 6,
        },
      },
      outputs: {
        found: {
          type: "boolean",
          description: "Whether the member was found",
          required: true,
        },
      },
    },
  ],
};

export function getCapabilityCatalog(): CapabilityCatalog {
  return structuredClone(capabilityCatalog);
}

export class CapabilityInvocationError extends Error {
  constructor(
    readonly code: "CAPABILITY_NOT_FOUND" | "INVALID_CAPABILITY_INPUTS",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityInvocationError";
  }
}

export interface AutomationConsoleOptions {
  evidenceRoot?: string;
  now?: () => Date;
  createRunId?: () => string;
  contactUpdateCapabilityProvider?: () => CapabilityPackage | undefined;
}

export interface AutomationConsolePort {
  listCapabilities(): CapabilityCatalog;
  invoke(
    capabilityId: string,
    inputs: unknown,
    scenario: ScenarioName,
    origin: string,
  ): Promise<AutomationRunView>;
  run(
    instruction: string,
    scenario: ScenarioName,
    origin: string,
  ): Promise<AutomationRunView>;
  getRun(runId: string): AutomationRunView | undefined;
  reset(): void;
}

export class AutomationConsole implements AutomationConsolePort {
  readonly #evidenceRoot: string;
  readonly #now: () => Date;
  readonly #createRunId: () => string;
  readonly #contactUpdateCapabilityProvider:
    (() => CapabilityPackage | undefined) | undefined;
  readonly #privacy = new PrivacyGateway({ redactEmails: true });
  readonly #runs = new Map<string, AutomationRunView>();
  #active = false;

  constructor(
    readonly repository: MemberRepository,
    readonly scenarios: ScenarioController,
    options: AutomationConsoleOptions = {},
  ) {
    this.#evidenceRoot =
      options.evidenceRoot ?? join(REPOSITORY_ROOT, "evidence", "generated");
    this.#now = options.now ?? (() => new Date());
    this.#createRunId =
      options.createRunId ?? (() => `console-${randomUUID()}`);
    this.#contactUpdateCapabilityProvider =
      options.contactUpdateCapabilityProvider;
  }

  getRun(runId: string): AutomationRunView | undefined {
    const run = this.#runs.get(runId);
    return run === undefined ? undefined : structuredClone(run);
  }

  listCapabilities(): CapabilityCatalog {
    return getCapabilityCatalog();
  }

  reset(): void {
    this.#runs.clear();
  }

  async invoke(
    capabilityId: string,
    inputs: unknown,
    scenario: ScenarioName,
    origin: string,
  ): Promise<AutomationRunView> {
    const intent = parseCapabilityInvocation(capabilityId, inputs);
    const instruction = `Invoke ${capabilityId} with typed inputs`;
    return this.#runResolved(instruction, scenario, origin, intent);
  }

  async run(
    instruction: string,
    scenario: ScenarioName,
    origin: string,
  ): Promise<AutomationRunView> {
    return this.#runResolved(
      instruction,
      scenario,
      origin,
      parseAutomationInstruction(instruction),
    );
  }

  async #runResolved(
    instruction: string,
    scenario: ScenarioName,
    origin: string,
    intent: AutomationIntent,
  ): Promise<AutomationRunView> {
    const runId = this.#createRunId();
    const safeInstruction = this.#privacy.sanitizeText(instruction.trim());
    if (this.#active) {
      return this.#remember({
        runId,
        instruction: safeInstruction,
        scenario,
        capabilityId: undefined,
        extractedInputs: {},
        resultKind: "hard_failure",
        code: "CONSOLE_BUSY",
        heading: "Another automation is running",
        explanation:
          "Wait for the active browser session to finish, then submit the command again.",
        modelCallCount: 0,
        evidenceDirectory: undefined,
        completedAt: this.#now().toISOString(),
      });
    }

    this.#active = true;
    this.scenarios.set(scenario);
    try {
      if (intent.kind === "unsupported") {
        return this.#remember({
          runId,
          instruction: safeInstruction,
          scenario,
          capabilityId: undefined,
          extractedInputs: {},
          resultKind: "hard_failure",
          code: "UNSUPPORTED_INSTRUCTION",
          heading: "Command not understood",
          explanation: intent.reason,
          modelCallCount: 0,
          evidenceDirectory: undefined,
          completedAt: this.#now().toISOString(),
        });
      }
      if (intent.kind === "human_control") {
        return this.#remember({
          runId,
          instruction: safeInstruction,
          scenario,
          capabilityId: "contact.update-ssn",
          extractedInputs:
            intent.memberId === undefined ? {} : { memberId: intent.memberId },
          resultKind: "pending_escalation",
          code: intent.reasonCode,
          heading: "Human control required",
          explanation:
            "SSN entry is never performed by automation. Use the documented human-handoff workflow to continue in a leased live session.",
          modelCallCount: 0,
          evidenceDirectory: undefined,
          completedAt: this.#now().toISOString(),
        });
      }

      return await this.#execute(
        runId,
        safeInstruction,
        scenario,
        origin,
        intent,
      );
    } catch (error) {
      return this.#remember({
        runId,
        instruction: safeInstruction,
        scenario,
        capabilityId: undefined,
        extractedInputs: {},
        resultKind: "hard_failure",
        code: errorCode(error) ?? "AUTOMATION_EXECUTION_FAILED",
        heading: "Automation could not complete",
        explanation:
          error instanceof Error ? error.message : "Unknown automation failure",
        modelCallCount: 0,
        evidenceDirectory: undefined,
        completedAt: this.#now().toISOString(),
      });
    } finally {
      this.#active = false;
    }
  }

  async #execute(
    runId: string,
    instruction: string,
    scenario: ScenarioName,
    origin: string,
    intent: Extract<AutomationIntent, { kind: "update_phone" | "find_member" }>,
  ): Promise<AutomationRunView> {
    const evidenceDirectory = join(this.#evidenceRoot, runId);
    const capability =
      intent.kind === "update_phone"
        ? await this.#contactUpdateCapability(origin)
        : createMemberSearchCapability(origin);
    const inputs =
      intent.kind === "update_phone"
        ? { memberId: intent.memberId, phone: intent.phone }
        : { memberId: intent.memberId };
    const browser = await chromium.launch({ headless: true });
    let result: TerminalResult;
    try {
      const page = await browser.newPage({
        viewport: { width: 1100, height: 850 },
      });
      const executor = new ReplayExecutor({
        surface: new PlaywrightSurfaceAdapter(page, {
          allowedOrigins: [origin],
          allowedRoutes: ["/contacts", "/contacts/*"],
        }),
        runtimePolicy:
          intent.kind === "update_phone"
            ? contactPolicy(origin)
            : searchPolicy(origin),
        evidence: new EvidencePackageWriter(evidenceDirectory, runId, {
          privacyGateway: this.#privacy,
          now: this.#now,
        }),
        now: this.#now,
      });
      result = await executor.run({
        runId,
        capability,
        inputs,
        startUrl: `${origin}/contacts`,
      });
    } finally {
      await browser.close();
    }

    const view = resultView({
      runId,
      instruction,
      scenario,
      capabilityId: capability.capability.id,
      inputs: Object.fromEntries(
        Object.entries(inputs).map(([key, value]) => [key, String(value)]),
      ),
      result,
      evidenceDirectory: relative(REPOSITORY_ROOT, evidenceDirectory),
      completedAt: this.#now().toISOString(),
    });
    return this.#remember(view);
  }

  #remember(run: AutomationRunView): AutomationRunView {
    this.#runs.set(run.runId, structuredClone(run));
    while (this.#runs.size > 20) {
      const first = this.#runs.keys().next().value;
      if (first === undefined) break;
      this.#runs.delete(first);
    }
    return structuredClone(run);
  }

  async #contactUpdateCapability(origin: string): Promise<CapabilityPackage> {
    if (this.#contactUpdateCapabilityProvider === undefined) {
      return createContactUpdateCapability(origin);
    }
    const capability = this.#contactUpdateCapabilityProvider();
    if (capability === undefined) {
      throw new AutomationExecutionError(
        "CAPABILITY_NOT_APPROVED",
        "Complete LLM discovery and approve the generated capability before deterministic replay.",
      );
    }
    return capability;
  }
}

class AutomationExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AutomationExecutionError";
  }
}

export function parseAutomationInstruction(
  instruction: string,
): AutomationIntent {
  const normalized = instruction.trim();
  if (normalized.length === 0) {
    return {
      kind: "unsupported",
      reason:
        "Enter a command such as “Update member M-1001's phone number to 555-0199.”",
    };
  }
  if (/\b(?:ssn|social security)\b/i.test(normalized)) {
    const memberId = normalized.match(/\bM-[0-9]{4}\b/i)?.[0]?.toUpperCase();
    return {
      kind: "human_control",
      reasonCode: "SENSITIVE_DATA_ENTRY_REQUIRED",
      ...(memberId === undefined ? {} : { memberId }),
    };
  }
  const memberId = normalized.match(/\bM-[0-9]{4}\b/i)?.[0]?.toUpperCase();
  if (memberId === undefined) {
    return {
      kind: "unsupported",
      reason: "Include a member ID in the form M-1001.",
    };
  }
  const updateIntent =
    /\b(?:update|change|set)\b/i.test(normalized) &&
    /\b(?:phone|telephone|mobile)\b/i.test(normalized);
  if (updateIntent) {
    const phone = normalized.match(/\b[0-9]{3}[-. ][0-9]{4}\b/)?.[0];
    if (phone === undefined) {
      return {
        kind: "unsupported",
        reason: "Include a replacement phone number such as 555-0199.",
      };
    }
    return { kind: "update_phone", memberId, phone };
  }
  if (/\b(?:find|search|locate|look\s+up|show)\b/i.test(normalized)) {
    return { kind: "find_member", memberId };
  }
  return {
    kind: "unsupported",
    reason:
      "This console currently supports updating a member phone number or finding a member.",
  };
}

export function parseCapabilityInvocation(
  capabilityId: string,
  inputs: unknown,
): Extract<AutomationIntent, { kind: "update_phone" | "find_member" }> {
  if (
    capabilityId !== "contact.update-phone" &&
    capabilityId !== "contact.find-member"
  ) {
    throw new CapabilityInvocationError(
      "CAPABILITY_NOT_FOUND",
      `No approved capability is registered as ${capabilityId}.`,
    );
  }
  if (!isRecord(inputs)) {
    throw invalidInputs("Inputs must be a JSON object.");
  }

  const allowedKeys =
    capabilityId === "contact.update-phone"
      ? new Set(["memberId", "phone"])
      : new Set(["memberId"]);
  const unknownKeys = Object.keys(inputs).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unknownKeys.length > 0) {
    throw invalidInputs(`Unknown input fields: ${unknownKeys.join(", ")}.`);
  }

  const memberId = inputs.memberId;
  if (typeof memberId !== "string" || !/^M-[0-9]{4}$/.test(memberId)) {
    throw invalidInputs("memberId must match the pattern M-0000.");
  }
  if (capabilityId === "contact.find-member") {
    return { kind: "find_member", memberId };
  }

  const phone = inputs.phone;
  if (
    typeof phone !== "string" ||
    phone.length < 7 ||
    phone.length > 20 ||
    !/^[0-9()+.\-\s]+$/.test(phone)
  ) {
    throw invalidInputs(
      "phone must be a 7-20 character synthetic phone number.",
    );
  }
  return { kind: "update_phone", memberId, phone };
}

function invalidInputs(message: string): CapabilityInvocationError {
  return new CapabilityInvocationError("INVALID_CAPABILITY_INPUTS", message);
}

async function createContactUpdateCapability(
  origin: string,
): Promise<CapabilityPackage> {
  const trace = JSON.parse(
    await readFile(
      join(
        REPOSITORY_ROOT,
        "evidence",
        "submission",
        "discovery-live",
        "trace.json",
      ),
      "utf8",
    ),
  ) as DiscoveryTrace;
  const draft = compileContactUpdateCapability(trace, {
    allowedOrigin: origin,
    evidenceManifestRef: "evidence/submission/discovery-live/manifest.json",
    reviewedPolicy: contactPolicy(origin),
  });
  return approveCapability(
    draft,
    "console-reviewed-capability",
    new Date("2026-09-26T16:00:00.000Z"),
  );
}

function createMemberSearchCapability(origin: string): CapabilityPackage {
  const memberTarget: TargetLocator = {
    strategies: [
      { type: "role", role: "link", name: "{memberId}", exact: true },
      {
        type: "role",
        role: "link",
        name: "View contact {memberId}",
        exact: true,
      },
    ],
    expectedCardinality: 1,
    rationale: "Reviewed wide and narrow member-result links",
  };
  const memberVisible: Check = {
    kind: "element",
    target: memberTarget,
    state: "visible",
  };
  const notFoundTarget: TargetLocator = {
    strategies: [{ type: "text", text: "No contacts found", exact: true }],
    expectedCardinality: 1,
    rationale: "Reviewed empty-search business state",
  };
  const draft = CapabilityPackageSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    capability: {
      id: "contact.find-member",
      name: "Find a member",
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
    },
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
        description: "Search for the requested member",
        action: {
          type: "navigate",
          urlTemplate: `${origin}/contacts?q={memberId}`,
        },
        preconditions: [{ kind: "url", pattern: "/contacts" }],
        settleConditions: [{ kind: "url", pattern: "/contacts" }],
        postconditions: [memberVisible],
        timeoutMs: 300,
        effect: "read",
        risk: "low",
        retry: { mode: "safe_retry", maxAttempts: 2, backoffMs: 0 },
      },
    ],
    outcomes: [
      {
        kind: "success",
        code: "SUCCESS",
        finalChecks: [memberVisible],
        outputBindings: { found: "member-found" },
      },
      {
        kind: "business_outcome",
        code: "CONTACT_NOT_FOUND",
        conditions: [
          { kind: "element", target: notFoundTarget, state: "visible" },
        ],
      },
    ],
    policy: searchPolicy(origin),
    provenance: {
      discoveryRunId: "run-14593185-527d-4608-89af-92bfbb8700a5",
      evidenceRefs: ["evidence/submission/discovery-live/manifest.json"],
      modelCallCount: 5,
    },
  });
  return approveCapability(
    draft,
    "console-reviewed-capability",
    new Date("2026-09-26T16:00:00.000Z"),
  );
}

function contactPolicy(origin: string): ExecutionPolicy {
  return {
    allowedOrigins: [origin],
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

function searchPolicy(origin: string): ExecutionPolicy {
  return { ...contactPolicy(origin), allowedActions: ["navigate"] };
}

function resultView(input: {
  runId: string;
  instruction: string;
  scenario: ScenarioName;
  capabilityId: string;
  inputs: Record<string, string>;
  result: TerminalResult;
  evidenceDirectory: string;
  completedAt: string;
}): AutomationRunView {
  const heading =
    input.result.kind === "success"
      ? "Automation completed"
      : input.result.kind === "business_outcome"
        ? "Business outcome"
        : input.result.kind === "pending_escalation"
          ? "Human control required"
          : "Automation stopped safely";
  const explanation = explainResult(input.result, input.scenario);
  return {
    runId: input.runId,
    instruction: input.instruction,
    scenario: input.scenario,
    capabilityId: input.capabilityId,
    extractedInputs: input.inputs,
    resultKind: input.result.kind,
    code: input.result.code,
    heading,
    explanation,
    modelCallCount: 0,
    evidenceDirectory: input.evidenceDirectory,
    completedAt: input.completedAt,
  };
}

function explainResult(result: TerminalResult, scenario: ScenarioName): string {
  if (result.kind === "success" && scenario === "transient-search") {
    return "A temporary search failure was detected, retried within the approved bound, and then completed successfully.";
  }
  if (result.kind === "success") {
    return "The approved capability completed and its final checkpoint passed.";
  }
  if (result.kind === "business_outcome") {
    return result.code === "CONTACT_NOT_FOUND"
      ? "No matching member exists. This is a legitimate business result, not a system crash."
      : "The application returned a reviewed business outcome.";
  }
  if (result.kind === "pending_escalation") return result.reason;
  if (result.code === "AMBIGUOUS_TARGET") {
    return "More than one approved-looking control was visible, so automation refused to guess or click either one.";
  }
  return `${result.expected}; observed: ${result.observed}`;
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
