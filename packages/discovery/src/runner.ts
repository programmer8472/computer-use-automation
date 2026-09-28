import { createHash } from "node:crypto";

import {
  SCHEMA_VERSION,
  type Action,
  type EvidenceEvent,
} from "@computer-use/contracts";
import { PrivacyGateway } from "@computer-use/evidence";
import type { EvidencePackageWriter } from "@computer-use/evidence";
import type { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import type { Locator } from "playwright";

import {
  assertActionAuthorized,
  assertDiscoveryRequestSafe,
  discoveryInterventionReason,
  DiscoveryPolicyError,
} from "./policy.js";
import { parseDiscoveryToolCall } from "./tools.js";
import type {
  DiscoveryModel,
  DiscoveryInput,
  DiscoveryRunRequest,
  DiscoveryRunResult,
  DiscoveryTrace,
  ModelToolResult,
  ObservationRecord,
} from "./types.js";

type EvidenceEventDetails<Event = EvidenceEvent> = Event extends EvidenceEvent
  ? Omit<
      Event,
      "schemaVersion" | "eventId" | "runId" | "sequence" | "timestamp"
    >
  : never;

export interface DiscoveryRunnerOptions {
  model: DiscoveryModel;
  surface: PlaywrightSurfaceAdapter;
  evidence: EvidencePackageWriter;
  privacyGateway?: PrivacyGateway;
  now?: () => Date;
}

export class DiscoveryRunner {
  readonly #model: DiscoveryModel;
  readonly #surface: PlaywrightSurfaceAdapter;
  readonly #evidence: EvidencePackageWriter;
  readonly #privacy: PrivacyGateway;
  readonly #now: () => Date;
  #sequence = 0;

  constructor(options: DiscoveryRunnerOptions) {
    this.#model = options.model;
    this.#surface = options.surface;
    this.#evidence = options.evidence;
    this.#privacy =
      options.privacyGateway ?? new PrivacyGateway({ redactEmails: true });
    this.#now = options.now ?? (() => new Date());
  }

  async run(request: DiscoveryRunRequest): Promise<DiscoveryRunResult> {
    await this.#evidence.initialize();
    await this.#appendEvent(request.runId, {
      type: "run_started",
      mode: "discovery",
    });

    let modelCallCount = 0;
    const trace: DiscoveryTrace = {
      schemaVersion: SCHEMA_VERSION,
      runId: request.runId,
      goal: this.#privacy.sanitizeText(request.goal),
      modelCallCount: 0,
      steps: [],
    };

    try {
      assertDiscoveryRequestSafe(request.goal, request.inputs, request.policy);
      const interventionReason = discoveryInterventionReason(request.goal);
      if (interventionReason !== undefined) {
        await this.#writeTrace(trace);
        await this.#appendEvent(request.runId, {
          type: "run_completed",
          resultKind: "pending_escalation",
          modelCallCount,
        });
        await this.#evidence.finalize();
        return {
          kind: "pending_escalation",
          runId: request.runId,
          modelCallCount,
          reasonCode: interventionReason,
        };
      }
      this.#surface.assertUrlAllowed(request.startUrl);
      await this.#surface.page.goto(request.startUrl);
      let observation = await this.#recordObservation(request.runId);
      let previousToolResult: ModelToolResult | undefined;
      const maximumModelCalls = request.maximumModelCalls ?? 12;

      while (modelCallCount < maximumModelCalls) {
        const result = await this.#model.nextTurn({
          goal: this.#privacy.sanitizeText(request.goal),
          inputs: this.#sanitizeInputs(request.inputs),
          observation: observation.observation,
          ...(previousToolResult === undefined ? {} : { previousToolResult }),
        });
        modelCallCount += 1;
        trace.modelCallCount = modelCallCount;

        if (result.toolCalls.length !== 1) {
          return await this.#hardFailure(
            request.runId,
            modelCallCount,
            "INVALID_MODEL_DECISION",
            "The model must select exactly one bounded tool per turn",
            trace,
          );
        }

        const call = result.toolCalls[0];
        if (call === undefined) {
          throw new Error("Expected one model tool call");
        }
        const parsed = parseDiscoveryToolCall(call);

        if (parsed.kind === "finish") {
          if (!(await request.verifySuccess())) {
            return await this.#hardFailure(
              request.runId,
              modelCallCount,
              "SUCCESS_NOT_VERIFIED",
              "The model declared completion but the independent verification failed",
              trace,
            );
          }
          await this.#writeTrace(trace);
          await this.#appendEvent(request.runId, {
            type: "run_completed",
            resultKind: "success",
            modelCallCount,
          });
          await this.#evidence.finalize();
          return {
            kind: "success",
            runId: request.runId,
            modelCallCount,
            trace,
          };
        }

        if (parsed.kind === "human") {
          await this.#writeTrace(trace);
          await this.#appendEvent(request.runId, {
            type: "run_completed",
            resultKind: "pending_escalation",
            modelCallCount,
          });
          await this.#evidence.finalize();
          return {
            kind: "pending_escalation",
            runId: request.runId,
            modelCallCount,
            reasonCode: parsed.reasonCode,
          };
        }

        const { action, target } = parsed.decision;
        assertActionAuthorized(action, request.inputs, request.policy);
        const resolved = await this.#surface.resolveTarget(target);
        await this.#assertResolvedTargetSafe(action, resolved.locator);
        const stepId = `step-${trace.steps.length + 1}`;
        await this.#appendEvent(request.runId, {
          type: "action",
          stepId,
          actionType: action.type,
          outcome: "attempted",
        });

        try {
          await this.#surface.act(action, this.#inputValues(request.inputs));
          this.#surface.assertCurrentLocationAllowed();
        } catch (error) {
          await this.#appendEvent(request.runId, {
            type: "action",
            stepId,
            actionType: action.type,
            outcome: "blocked",
          });
          throw error;
        }

        await this.#appendEvent(request.runId, {
          type: "action",
          stepId,
          actionType: action.type,
          outcome: "completed",
        });
        const after = await this.#recordObservation(request.runId, stepId);
        trace.steps.push({
          id: stepId,
          observationBeforeRef: observation.artifactRef,
          observationBeforeDigest: observation.digest,
          action,
          resolvedStrategyIndex: resolved.strategyIndex,
          observationAfterRef: after.artifactRef,
          observationAfterDigest: after.digest,
        });
        observation = after;
        previousToolResult = {
          callId: parsed.decision.callId,
          output: {
            ok: true,
            currentPage: after.observation,
          },
        };
      }

      return await this.#hardFailure(
        request.runId,
        modelCallCount,
        "MODEL_CALL_LIMIT",
        "Discovery stopped at the configured model-call limit",
        trace,
      );
    } catch (error) {
      const code =
        error instanceof DiscoveryPolicyError
          ? error.code
          : "DISCOVERY_EXECUTION_FAILED";
      const message =
        error instanceof Error ? error.message : "Unknown discovery failure";
      return await this.#hardFailure(
        request.runId,
        modelCallCount,
        code,
        this.#privacy.sanitizeText(message),
        trace,
      );
    }
  }

  async #recordObservation(
    runId: string,
    stepId?: string,
  ): Promise<ObservationRecord> {
    const raw = await this.#surface.observe();
    const observation = this.#privacy.sanitize(raw) as unknown as typeof raw;
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
    return { observation, artifactRef, digest };
  }

  async #assertResolvedTargetSafe(
    action: Action,
    locator: Locator,
  ): Promise<void> {
    const inputType = await locator.getAttribute("type");
    if (inputType === "password") {
      throw new DiscoveryPolicyError(
        "SENSITIVE_TARGET_BLOCKED",
        "Discovery cannot interact with password controls",
      );
    }
    if (action.type !== "click") return;
    const href = await locator.getAttribute("href");
    if (href !== null) {
      this.#surface.assertUrlAllowed(
        new URL(href, this.#surface.page.url()).href,
      );
    }
  }

  #sanitizeInputs(
    inputs: Readonly<Record<string, DiscoveryInput>>,
  ): Readonly<Record<string, DiscoveryInput>> {
    return Object.fromEntries(
      Object.entries(inputs).map(([name, input]) => [
        name,
        {
          ...input,
          value: this.#privacy.sanitizeText(input.value),
        },
      ]),
    );
  }

  #inputValues(
    inputs: Readonly<Record<string, DiscoveryInput>>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(inputs).map(([name, input]) => [name, input.value]),
    );
  }

  async #writeTrace(trace: DiscoveryTrace): Promise<void> {
    await this.#evidence.writeJsonArtifact("trace.json", trace);
  }

  async #hardFailure(
    runId: string,
    modelCallCount: number,
    code: string,
    message: string,
    trace: DiscoveryTrace,
  ): Promise<DiscoveryRunResult> {
    trace.modelCallCount = modelCallCount;
    await this.#writeTrace(trace);
    await this.#appendEvent(runId, {
      type: "run_completed",
      resultKind: "hard_failure",
      modelCallCount,
    });
    await this.#evidence.finalize();
    return { kind: "hard_failure", runId, modelCallCount, code, message };
  }

  async #appendEvent(
    runId: string,
    event: EvidenceEventDetails,
  ): Promise<void> {
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
