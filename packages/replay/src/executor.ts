import { createHash } from "node:crypto";

import { verifyApprovedCapability } from "@computer-use/compiler";
import {
  SCHEMA_VERSION,
  type CapabilityPackage,
  type Check,
  type EvidenceEvent,
  type ExecutionPolicy,
  type Step,
  type TerminalResult,
} from "@computer-use/contracts";
import type { EvidencePackageWriter } from "@computer-use/evidence";
import {
  authorizeResolvedAction,
  intersectPolicies,
  PolicyDeniedError,
} from "@computer-use/policy";

import { hydrateAction, hydrateCheck } from "./hydration.js";
import type {
  ReplayExecutorOptions,
  ReplayRequest,
  ReplayResult,
  ReplaySurface,
} from "./types.js";

type EvidenceEventDetails<Event = EvidenceEvent> = Event extends EvidenceEvent
  ? Omit<
      Event,
      "schemaVersion" | "eventId" | "runId" | "sequence" | "timestamp"
    >
  : never;

class ReplayFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly stepId?: string,
  ) {
    super(message);
    this.name = "ReplayFailure";
  }
}

export class ReplayExecutor {
  readonly #surface: ReplaySurface;
  readonly #runtimePolicy: ExecutionPolicy;
  readonly #evidence: EvidencePackageWriter | undefined;
  readonly #now: () => Date;
  #sequence = 0;

  constructor(options: ReplayExecutorOptions) {
    this.#surface = options.surface;
    this.#runtimePolicy = options.runtimePolicy;
    this.#evidence = options.evidence;
    this.#now = options.now ?? (() => new Date());
  }

  async run(request: ReplayRequest): Promise<ReplayResult> {
    if (this.#evidence !== undefined) await this.#evidence.initialize();
    await this.#appendEvent(request.runId, {
      type: "run_started",
      mode: "replay",
    });

    const approval = verifyApprovedCapability(request.capability);
    if (!approval.valid) {
      return this.#hardFailure(
        request,
        "CAPABILITY_NOT_APPROVED",
        approval.reason,
      );
    }
    const capability = approval.capability;
    const effectivePolicy = intersectPolicies(
      capability.policy,
      this.#runtimePolicy,
    );

    try {
      validateInputs(capability, request.inputs, effectivePolicy);
      assertStartAllowed(
        request.startUrl,
        capability.policy,
        this.#runtimePolicy,
      );
      this.#surface.assertUrlAllowed(request.startUrl);
      await this.#surface.act(
        { type: "navigate", urlTemplate: request.startUrl },
        {},
      );
      await this.#recordObservation(request.runId);

      for (const step of capability.steps) {
        const terminal = await this.#executeStep(
          request,
          capability,
          step,
          effectivePolicy,
        );
        if (terminal !== undefined) return terminal;
      }

      const success = capability.outcomes.find(
        (outcome) => outcome.kind === "success",
      );
      if (
        success === undefined ||
        !(await this.#checksPass(
          success.finalChecks.map((check) =>
            hydrateCheck(check, request.inputs),
          ),
        ))
      ) {
        throw new ReplayFailure(
          "FINAL_CHECK_FAILED",
          "The capability completed but its success contract did not pass",
        );
      }

      const outputs = Object.fromEntries(
        Object.keys(success.outputBindings).map((name) => [name, true]),
      );
      return this.#finish(request, capability, {
        schemaVersion: SCHEMA_VERSION,
        runId: request.runId,
        capabilityId: capability.capability.id,
        evidenceRefs: this.#resultEvidenceRefs(),
        completedAt: this.#now().toISOString(),
        kind: "success",
        code: "SUCCESS",
        outputs,
      });
    } catch (error) {
      const failure =
        error instanceof ReplayFailure
          ? error
          : error instanceof PolicyDeniedError
            ? new ReplayFailure(error.code, error.message)
            : new ReplayFailure(
                errorCode(error) ?? "REPLAY_EXECUTION_FAILED",
                error instanceof Error
                  ? error.message
                  : "Unknown replay failure",
              );
      const firstStepId = capability.steps[0]?.id;
      const businessOutcome =
        failure.stepId === firstStepId
          ? await this.#classifyBusinessOutcome(capability, request.inputs)
          : undefined;
      if (businessOutcome !== undefined) {
        return this.#finish(request, capability, {
          schemaVersion: SCHEMA_VERSION,
          runId: request.runId,
          capabilityId: capability.capability.id,
          evidenceRefs: this.#resultEvidenceRefs(),
          completedAt: this.#now().toISOString(),
          kind: "business_outcome",
          code: businessOutcome,
          details: { classification: "reviewed_business_outcome" },
        });
      }
      return this.#hardFailure(
        request,
        failure.code,
        failure.message,
        capability,
        failure.stepId,
      );
    }
  }

  async #executeStep(
    request: ReplayRequest,
    capability: CapabilityPackage,
    step: Step,
    effectivePolicy: ExecutionPolicy,
  ): Promise<TerminalResult | undefined> {
    const action = hydrateAction(step.action, request.inputs);
    const preconditions = step.preconditions.map((check) =>
      hydrateCheck(check, request.inputs),
    );
    const settleConditions = step.settleConditions.map((check) =>
      hydrateCheck(check, request.inputs),
    );
    const postconditions = step.postconditions.map((check) =>
      hydrateCheck(check, request.inputs),
    );
    assertActionAllowed(action.type, effectivePolicy);

    if (action.type === "human_control") {
      return this.#finish(request, capability, {
        schemaVersion: SCHEMA_VERSION,
        runId: request.runId,
        capabilityId: capability.capability.id,
        evidenceRefs: this.#resultEvidenceRefs(),
        completedAt: this.#now().toISOString(),
        kind: "pending_escalation",
        code: action.reasonCode,
        interventionId: `intervention-${request.runId}`,
        reason: "The approved capability requires human control",
      });
    }

    const maximumAttempts = Math.min(
      step.retry.maxAttempts,
      Math.max(1, effectivePolicy.maximumRecoveryAttempts + 1),
    );
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      let preconditionsPass: boolean;
      try {
        preconditionsPass = await this.#checksPass(preconditions);
      } catch (error) {
        throw new ReplayFailure(
          errorCode(error) ?? "PRECONDITION_FAILED",
          error instanceof Error
            ? error.message
            : `Preconditions could not be evaluated for ${step.id}`,
          step.id,
        );
      }
      if (!preconditionsPass) {
        throw new ReplayFailure(
          "PRECONDITION_FAILED",
          `Preconditions did not pass for ${step.id}`,
          step.id,
        );
      }

      if (
        action.type === "click" ||
        action.type === "fill" ||
        action.type === "select" ||
        action.type === "capture"
      ) {
        const control = await this.#surface.inspectTarget(action.target);
        authorizeResolvedAction(action, control, effectivePolicy);
      }

      await this.#appendEvent(request.runId, {
        type: "action",
        stepId: step.id,
        actionType: action.type,
        outcome: "attempted",
      });
      try {
        await this.#surface.act(action, request.inputs);
        await this.#appendEvent(request.runId, {
          type: "action",
          stepId: step.id,
          actionType: action.type,
          outcome: "completed",
        });
        await this.#surface.settle(settleConditions, step.timeoutMs);
        if (!(await this.#checksPass(postconditions))) {
          throw new ReplayFailure(
            "POSTCONDITION_FAILED",
            `Postconditions did not pass for ${step.id}`,
            step.id,
          );
        }
        await this.#recordObservation(request.runId, step.id);
        return undefined;
      } catch (error) {
        if (step.effect === "write" || step.effect === "irreversible") {
          if (await this.#checksPass(postconditions)) {
            await this.#appendEvent(request.runId, {
              type: "action",
              stepId: step.id,
              actionType: action.type,
              outcome: "completed",
            });
            await this.#recordObservation(request.runId, step.id);
            return undefined;
          }
          throw new ReplayFailure(
            "WRITE_OUTCOME_UNCERTAIN",
            `The write outcome for ${step.id} could not be reconciled and was not repeated`,
            step.id,
          );
        }
        if (attempt === maximumAttempts || step.retry.mode !== "safe_retry") {
          throw error;
        }
      }
    }
    throw new ReplayFailure(
      "RECOVERY_EXHAUSTED",
      `Recovery attempts were exhausted for ${step.id}`,
      step.id,
    );
  }

  async #classifyBusinessOutcome(
    capability: CapabilityPackage,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<string | undefined> {
    for (const outcome of capability.outcomes) {
      if (outcome.kind !== "business_outcome") continue;
      const checks = outcome.conditions.map((check) =>
        hydrateCheck(check, inputs),
      );
      try {
        if (await this.#checksPass(checks)) return outcome.code;
      } catch {
        // An unsupported classifier is not a match.
      }
    }
    return undefined;
  }

  async #checksPass(checks: readonly Check[]): Promise<boolean> {
    const results = await Promise.all(
      checks.map(async (check) => this.#surface.check(check)),
    );
    return results.every(Boolean);
  }

  async #recordObservation(runId: string, stepId?: string): Promise<void> {
    if (this.#evidence === undefined) return;
    const observation = await this.#surface.observe();
    const digest = createHash("sha256")
      .update(JSON.stringify(observation))
      .digest("hex");
    const artifactRef = `observations/observation-${this.#sequence}.json`;
    await this.#evidence.writeJsonArtifact(artifactRef, observation);
    await this.#appendEvent(runId, {
      type: "observation",
      ...(stepId === undefined ? {} : { stepId }),
      stateDigest: digest,
      redactedArtifactRef: artifactRef,
    });
  }

  async #hardFailure(
    request: ReplayRequest,
    code: string,
    message: string,
    capability?: CapabilityPackage,
    stepId?: string,
  ): Promise<ReplayResult> {
    const result: TerminalResult = {
      schemaVersion: SCHEMA_VERSION,
      runId: request.runId,
      capabilityId: capability?.capability.id ?? "unknown-capability",
      evidenceRefs: this.#resultEvidenceRefs(),
      completedAt: this.#now().toISOString(),
      kind: "hard_failure",
      code,
      ...(stepId === undefined ? {} : { stepId }),
      expected: "Approved capability state contract",
      observed: message,
    };
    return this.#finish(request, capability, result);
  }

  async #finish(
    request: ReplayRequest,
    _capability: CapabilityPackage | undefined,
    result: TerminalResult,
  ): Promise<ReplayResult> {
    await this.#appendEvent(request.runId, {
      type: "run_completed",
      resultKind: result.kind,
      modelCallCount: 0,
    });
    if (this.#evidence !== undefined) {
      await this.#evidence.writeJsonArtifact("result.json", result);
      await this.#evidence.finalize();
    }
    return result;
  }

  #resultEvidenceRefs(): string[] {
    return this.#evidence === undefined ? [] : ["manifest.json"];
  }

  async #appendEvent(
    runId: string,
    event: EvidenceEventDetails,
  ): Promise<void> {
    if (this.#evidence === undefined) return;
    const sequence = this.#sequence;
    this.#sequence += 1;
    await this.#evidence.appendEvent({
      schemaVersion: SCHEMA_VERSION,
      eventId: `event-${sequence}`,
      runId,
      sequence,
      timestamp: this.#now().toISOString(),
      ...event,
    });
  }
}

function validateInputs(
  capability: CapabilityPackage,
  inputs: Readonly<Record<string, unknown>>,
  effectivePolicy: ExecutionPolicy,
): void {
  for (const name of Object.keys(inputs)) {
    if (!(name in capability.inputs)) {
      throw new ReplayFailure("UNKNOWN_INPUT", `Input ${name} is not declared`);
    }
  }
  for (const [name, definition] of Object.entries(capability.inputs)) {
    const value = inputs[name];
    if (definition.required && value === undefined) {
      throw new ReplayFailure("MISSING_INPUT", `Input ${name} is required`);
    }
    if (value === undefined) continue;
    if (effectivePolicy.blockedDataClasses.includes(definition.dataClass)) {
      throw new ReplayFailure(
        "DATA_CLASS_BLOCKED",
        `Input ${name} belongs to a blocked data class`,
      );
    }
    if (definition.type === "string") {
      if (typeof value !== "string") {
        throw new ReplayFailure("INVALID_INPUT", `Input ${name} must be text`);
      }
      if (
        definition.minLength !== undefined &&
        value.length < definition.minLength
      ) {
        throw new ReplayFailure("INVALID_INPUT", `Input ${name} is too short`);
      }
      if (
        definition.maxLength !== undefined &&
        value.length > definition.maxLength
      ) {
        throw new ReplayFailure("INVALID_INPUT", `Input ${name} is too long`);
      }
      if (
        definition.pattern !== undefined &&
        !new RegExp(definition.pattern).test(value)
      ) {
        throw new ReplayFailure(
          "INVALID_INPUT",
          `Input ${name} has an invalid format`,
        );
      }
    } else if (definition.type === "number" && typeof value !== "number") {
      throw new ReplayFailure("INVALID_INPUT", `Input ${name} must be numeric`);
    } else if (definition.type === "boolean" && typeof value !== "boolean") {
      throw new ReplayFailure("INVALID_INPUT", `Input ${name} must be boolean`);
    } else if (
      definition.type === "enum" &&
      (typeof value !== "string" || !definition.values.includes(value))
    ) {
      throw new ReplayFailure(
        "INVALID_INPUT",
        `Input ${name} is outside the allowed values`,
      );
    }
  }
}

function assertStartAllowed(
  value: string,
  artifactPolicy: ExecutionPolicy,
  runtimePolicy: ExecutionPolicy,
): void {
  const url = new URL(value);
  for (const policy of [artifactPolicy, runtimePolicy]) {
    if (!policy.allowedOrigins.includes(url.origin)) {
      throw new ReplayFailure(
        "ORIGIN_NOT_ALLOWED",
        `Origin ${url.origin} is not allowed by effective policy`,
      );
    }
    if (!policy.allowedRoutes.some((route) => matches(url.pathname, route))) {
      throw new ReplayFailure(
        "ROUTE_NOT_ALLOWED",
        `Route ${url.pathname} is not allowed by effective policy`,
      );
    }
  }
}

function assertActionAllowed(
  action: string,
  effectivePolicy: ExecutionPolicy,
): void {
  if (
    !effectivePolicy.allowedActions.includes(
      action as ExecutionPolicy["allowedActions"][number],
    )
  ) {
    throw new ReplayFailure(
      "ACTION_NOT_ALLOWED",
      `Action ${action} is outside effective authority`,
    );
  }
}

function matches(value: string, pattern: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(value);
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
