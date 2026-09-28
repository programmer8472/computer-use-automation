import { randomUUID } from "node:crypto";

import {
  InterventionRequestSchema,
  SCHEMA_VERSION,
  type Check,
  type InterventionRequest,
} from "@computer-use/contracts";
import { PrivacyGateway } from "@computer-use/evidence";

export type SessionActor = "automation" | "operator";

export interface InterventionInput {
  runId: string;
  capabilityId: string;
  stepId: string;
  reasonCode: string;
  reason: string;
  redactedContext: Readonly<Record<string, string>>;
  requiredResumeChecks: readonly Check[];
}

export interface InterventionAuditEntry {
  sequence: number;
  interventionId: string;
  status: "requested" | "claimed" | "released" | "resumed";
  leaseOwner: InterventionRequest["leaseOwner"];
  timestamp: string;
  redactedContext: Record<string, string>;
}

export type InterventionAuditSink = (
  entry: InterventionAuditEntry,
) => Promise<void> | void;

export interface BrowserSessionControllerOptions {
  now?: () => Date;
  createId?: () => string;
  auditSink?: InterventionAuditSink;
  privacyGateway?: PrivacyGateway;
}

export class SessionLeaseError extends Error {
  readonly code = "SESSION_LEASE_VIOLATION";

  constructor(message: string) {
    super(message);
    this.name = "SessionLeaseError";
  }
}

export class ResumeVerificationError extends Error {
  readonly code = "RESUME_CHECK_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "ResumeVerificationError";
  }
}

export class BrowserSessionController {
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #auditSink: InterventionAuditSink | undefined;
  readonly #privacy: PrivacyGateway;
  readonly #audit: InterventionAuditEntry[] = [];
  #leaseOwner: InterventionRequest["leaseOwner"] = "automation";
  #intervention: InterventionRequest | undefined;

  constructor(options: BrowserSessionControllerOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? (() => `intervention-${randomUUID()}`);
    this.#auditSink = options.auditSink;
    this.#privacy = options.privacyGateway ?? new PrivacyGateway();
  }

  get leaseOwner(): InterventionRequest["leaseOwner"] {
    return this.#leaseOwner;
  }

  get currentIntervention(): InterventionRequest | undefined {
    return this.#intervention === undefined
      ? undefined
      : structuredClone(this.#intervention);
  }

  get auditLog(): readonly InterventionAuditEntry[] {
    return structuredClone(this.#audit);
  }

  assertOwner(actor: SessionActor): void {
    if (this.#leaseOwner !== actor) {
      throw new SessionLeaseError(
        `${actor} cannot use the browser while the lease owner is ${this.#leaseOwner}`,
      );
    }
  }

  async requestIntervention(
    input: InterventionInput,
  ): Promise<InterventionRequest> {
    this.assertOwner("automation");
    if (this.#intervention !== undefined) {
      throw new SessionLeaseError("A browser intervention is already active");
    }

    const request = InterventionRequestSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      interventionId: this.#createId(),
      runId: input.runId,
      capabilityId: input.capabilityId,
      stepId: input.stepId,
      status: "requested",
      leaseOwner: "released",
      reasonCode: input.reasonCode,
      reason: this.#privacy.sanitizeText(input.reason),
      redactedContext: this.#sanitizeContext(input.redactedContext),
      requiredResumeChecks: input.requiredResumeChecks,
      createdAt: this.#now().toISOString(),
    });
    await this.#commit(request, "requested");
    return structuredClone(request);
  }

  async claim(interventionId: string): Promise<InterventionRequest> {
    const current = this.#requireIntervention(interventionId);
    if (
      (current.status !== "requested" && current.status !== "released") ||
      this.#leaseOwner !== "released"
    ) {
      throw new SessionLeaseError(
        "Only a released intervention can be claimed",
      );
    }
    const next = InterventionRequestSchema.parse({
      ...current,
      status: "claimed",
      leaseOwner: "operator",
    });
    await this.#commit(next, "claimed");
    return structuredClone(next);
  }

  async release(interventionId: string): Promise<InterventionRequest> {
    const current = this.#requireIntervention(interventionId);
    if (current.status !== "claimed" || this.#leaseOwner !== "operator") {
      throw new SessionLeaseError(
        "Only the operator holding the browser lease can release it",
      );
    }
    const next = InterventionRequestSchema.parse({
      ...current,
      status: "released",
      leaseOwner: "released",
    });
    await this.#commit(next, "released");
    return structuredClone(next);
  }

  async resume(
    interventionId: string,
    verify: (checks: readonly Check[]) => Promise<boolean>,
  ): Promise<InterventionRequest> {
    const current = this.#requireIntervention(interventionId);
    if (current.status !== "released" || this.#leaseOwner !== "released") {
      throw new SessionLeaseError(
        "Automation can resume only after the operator releases the browser",
      );
    }
    if (!(await verify(current.requiredResumeChecks))) {
      throw new ResumeVerificationError(
        "The required same-session resume checkpoint was not observed",
      );
    }
    const next = InterventionRequestSchema.parse({
      ...current,
      status: "resumed",
      leaseOwner: "automation",
    });
    await this.#commit(next, "resumed");
    return structuredClone(next);
  }

  #requireIntervention(interventionId: string): InterventionRequest {
    if (
      this.#intervention === undefined ||
      this.#intervention.interventionId !== interventionId
    ) {
      throw new SessionLeaseError(`Unknown intervention ${interventionId}`);
    }
    return this.#intervention;
  }

  #sanitizeContext(
    context: Readonly<Record<string, string>>,
  ): Record<string, string> {
    const sanitized = this.#privacy.sanitize(context);
    if (
      sanitized === null ||
      typeof sanitized !== "object" ||
      Array.isArray(sanitized)
    ) {
      throw new TypeError("Intervention context must be a string record");
    }
    return Object.fromEntries(
      Object.entries(sanitized).map(([key, value]) => {
        if (typeof value !== "string") {
          throw new TypeError("Intervention context values must be strings");
        }
        return [key, value];
      }),
    );
  }

  async #commit(
    intervention: InterventionRequest,
    status: InterventionAuditEntry["status"],
  ): Promise<void> {
    const entry: InterventionAuditEntry = {
      sequence: this.#audit.length,
      interventionId: intervention.interventionId,
      status,
      leaseOwner: intervention.leaseOwner,
      timestamp: this.#now().toISOString(),
      redactedContext: structuredClone(intervention.redactedContext),
    };
    await this.#auditSink?.(entry);
    this.#intervention = intervention;
    this.#leaseOwner = intervention.leaseOwner;
    this.#audit.push(entry);
  }
}
