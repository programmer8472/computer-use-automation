import type {
  Check,
  InterventionRequest,
  TargetLocator,
} from "@computer-use/contracts";
import type { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";

import type { BrowserSessionController } from "./controller.js";

const editContactTarget: TargetLocator = {
  strategies: [
    { type: "role", role: "link", name: "Edit contact", exact: true },
  ],
  expectedCardinality: 1,
  rationale: "The contact detail page exposes one semantic edit link",
};

const ssnTarget: TargetLocator = {
  strategies: [
    {
      type: "label",
      label: "Social Security number (human entry only)",
      exact: true,
    },
  ],
  expectedCardinality: 1,
  rationale: "The protected field is identified by its accessible label",
};

function onFileTarget(): TargetLocator {
  return {
    strategies: [{ type: "text", text: "On file", exact: true }],
    expectedCardinality: 1,
    context: { ancestorRole: "definition" },
    rationale: "The contact detail state confirms only that an SSN is on file",
  };
}

export interface SsnHandoffPreparation {
  runId: string;
  memberId: string;
  startUrl: string;
  capabilityId?: string;
}

export class SsnHandoffCoordinator {
  constructor(
    readonly surface: PlaywrightSurfaceAdapter,
    readonly session: BrowserSessionController,
  ) {}

  async prepare(input: SsnHandoffPreparation): Promise<InterventionRequest> {
    this.session.assertOwner("automation");
    const detailUrl = new URL(
      `/contacts/${encodeURIComponent(input.memberId)}`,
      input.startUrl,
    ).href;
    await this.surface.act({ type: "navigate", urlTemplate: detailUrl }, {});
    await this.surface.act({ type: "click", target: editContactTarget }, {});

    const inspection = await this.surface.inspectTarget(ssnTarget);
    if (inspection.tag !== "input" || inspection.inputType !== "password") {
      throw new Error("The SSN handoff target is not a masked password input");
    }

    const requiredResumeChecks: Check[] = [
      {
        kind: "url",
        pattern: `/contacts/${input.memberId}`,
      },
      {
        kind: "element",
        target: onFileTarget(),
        state: "visible",
      },
    ];
    return this.session.requestIntervention({
      runId: input.runId,
      capabilityId: input.capabilityId ?? "contact.update-ssn",
      stepId: "human-enter-ssn",
      reasonCode: "SENSITIVE_DATA_ENTRY_REQUIRED",
      reason:
        "A human operator must enter the SSN in the masked field in this browser session.",
      redactedContext: {
        memberId: input.memberId,
        instruction:
          "Claim the browser, enter the SSN, save, then release control.",
      },
      requiredResumeChecks,
    });
  }

  async resume(interventionId: string): Promise<InterventionRequest> {
    return this.session.resume(interventionId, async (checks) => {
      const results = await Promise.all(
        checks.map(async (check) => this.surface.check(check)),
      );
      return results.every(Boolean);
    });
  }
}

export { ssnTarget };
