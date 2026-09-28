import type { Check } from "@computer-use/contracts";
import { describe, expect, it } from "vitest";

import {
  BrowserSessionController,
  ResumeVerificationError,
  SessionLeaseError,
} from "../src/controller.js";

const resumeCheck: Check = {
  kind: "url",
  pattern: "/contacts/M-1001",
};

describe("exclusive browser session lease", () => {
  it("enforces release, claim, release, verify, and resume in order", async () => {
    const session = createSession();
    const request = await session.requestIntervention({
      runId: "run-handoff",
      capabilityId: "contact.update-ssn",
      stepId: "human-enter-ssn",
      reasonCode: "SENSITIVE_DATA_ENTRY_REQUIRED",
      reason: "Human entry is required",
      redactedContext: { memberId: "M-1001" },
      requiredResumeChecks: [resumeCheck],
    });

    expect(request.leaseOwner).toBe("released");
    expect(() => session.assertOwner("automation")).toThrow(SessionLeaseError);
    await session.claim(request.interventionId);
    expect(session.leaseOwner).toBe("operator");
    expect(() => session.assertOwner("operator")).not.toThrow();
    await expect(
      session.resume(request.interventionId, () => Promise.resolve(true)),
    ).rejects.toThrow(SessionLeaseError);

    await session.release(request.interventionId);
    await expect(
      session.resume(request.interventionId, () => Promise.resolve(false)),
    ).rejects.toThrow(ResumeVerificationError);
    expect(session.leaseOwner).toBe("released");

    await session.claim(request.interventionId);
    await session.release(request.interventionId);
    const resumed = await session.resume(request.interventionId, (checks) =>
      Promise.resolve(checks.length === 1),
    );
    expect(resumed.status).toBe("resumed");
    expect(session.leaseOwner).toBe("automation");
    expect(session.auditLog.map((entry) => entry.status)).toEqual([
      "requested",
      "claimed",
      "released",
      "claimed",
      "released",
      "resumed",
    ]);
  });

  it("redacts protected context before it reaches the request or audit", async () => {
    const session = createSession();
    const protectedValue = ["321", "54", "9876"].join("-");
    const request = await session.requestIntervention({
      runId: "run-redaction",
      capabilityId: "contact.update-ssn",
      stepId: "human-enter-ssn",
      reasonCode: "SENSITIVE_DATA_ENTRY_REQUIRED",
      reason: `Never retain ${protectedValue}`,
      redactedContext: { ssn: protectedValue, note: protectedValue },
      requiredResumeChecks: [resumeCheck],
    });

    expect(JSON.stringify(request)).not.toContain(protectedValue);
    expect(JSON.stringify(session.auditLog)).not.toContain(protectedValue);
    expect(request.reason).toContain("[REDACTED:SSN]");
    expect(request.redactedContext.ssn).toBe("[REDACTED:SSN]");
  });
});

function createSession(): BrowserSessionController {
  return new BrowserSessionController({
    createId: () => "intervention-test-1",
    now: () => new Date("2026-09-26T14:00:00.000Z"),
  });
}
