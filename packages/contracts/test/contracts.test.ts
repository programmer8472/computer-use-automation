import { describe, expect, it } from "vitest";

import {
  CapabilityPackageSchema,
  EvidenceEventSchema,
  InterventionRequestSchema,
  TerminalResultSchema,
} from "../src/index.js";
import {
  ambiguousSuccessFixture,
  missingVersionFixture,
  unknownActionFixture,
  unsafeRetryFixture,
  validCapabilityFixture,
} from "./fixtures.js";

describe("CapabilityPackageSchema", () => {
  it("round-trips a representative contact update capability", () => {
    const parsed = CapabilityPackageSchema.parse(validCapabilityFixture);
    const roundTripped = JSON.parse(JSON.stringify(parsed)) as unknown;

    expect(CapabilityPackageSchema.parse(roundTripped)).toEqual(parsed);
  });

  it("rejects a package without a schema version", () => {
    expect(
      CapabilityPackageSchema.safeParse(missingVersionFixture()).success,
    ).toBe(false);
  });

  it("rejects unknown action types", () => {
    expect(
      CapabilityPackageSchema.safeParse(unknownActionFixture()).success,
    ).toBe(false);
  });

  it("rejects ambiguous success contracts", () => {
    expect(
      CapabilityPackageSchema.safeParse(ambiguousSuccessFixture()).success,
    ).toBe(false);
  });

  it("rejects blind retries for external-effecting actions", () => {
    expect(
      CapabilityPackageSchema.safeParse(unsafeRetryFixture()).success,
    ).toBe(false);
  });
});

describe("runtime record schemas", () => {
  it("accepts a redacted evidence event", () => {
    expect(
      EvidenceEventSchema.parse({
        schemaVersion: "1.0.0",
        eventId: "event-001",
        runId: "run-001",
        sequence: 0,
        timestamp: "2026-09-25T18:00:00Z",
        type: "observation",
        stateDigest:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        redactedArtifactRef: "evidence/generated/run-001/observation-000.json",
      }).type,
    ).toBe("observation");
  });

  it("accepts a same-session intervention request", () => {
    expect(
      InterventionRequestSchema.parse({
        schemaVersion: "1.0.0",
        interventionId: "intervention-001",
        runId: "run-001",
        capabilityId: "contact.update-ssn",
        stepId: "enter-ssn",
        status: "requested",
        leaseOwner: "released",
        reasonCode: "SENSITIVE_ENTRY_REQUIRED",
        reason: "A human must enter the sensitive value",
        redactedContext: { member: "synthetic-member" },
        requiredResumeChecks: [
          { kind: "marker", name: "ssn-on-file", value: true },
        ],
        createdAt: "2026-09-25T18:01:00Z",
      }).leaseOwner,
    ).toBe("released");
  });

  it("keeps business outcomes distinct from hard failures", () => {
    const result = TerminalResultSchema.parse({
      schemaVersion: "1.0.0",
      runId: "run-002",
      capabilityId: "contact.update-phone",
      evidenceRefs: ["evidence/generated/run-002/manifest.json"],
      completedAt: "2026-09-25T18:02:00Z",
      kind: "business_outcome",
      code: "CONTACT_NOT_FOUND",
      details: { member: "synthetic-member" },
    });

    expect(result.kind).toBe("business_outcome");
  });
});
