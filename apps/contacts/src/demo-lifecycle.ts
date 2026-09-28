import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  approveCapability,
  compileContactUpdateCapability,
  verifyApprovedCapability,
} from "@computer-use/compiler";
import type {
  CapabilityPackage,
  ExecutionPolicy,
} from "@computer-use/contracts";
import {
  DiscoveryRunner,
  OpenAIDiscoveryModel,
  type DiscoveryModel,
  type DiscoveryTrace,
} from "@computer-use/discovery";
import { EvidencePackageWriter, PrivacyGateway } from "@computer-use/evidence";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium, type Browser } from "playwright";

import type { AutomationRunView } from "./automation.js";
import type { MemberRepository } from "./repository.js";
import type { ScenarioController } from "./scenarios.js";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export type DemoLifecycleStatus =
  "discovery_required" | "draft_ready" | "approved" | "replay_complete";

export interface DiscoveryStepView {
  number: number;
  action: string;
  semanticTarget: string;
}

export interface DemoLifecycleView {
  status: DemoLifecycleStatus;
  activePhase: 1 | 2 | 3;
  modelConfigured: boolean;
  modelName: string;
  busy: boolean;
  error?: string;
  discovery?: {
    runId: string;
    goal: string;
    modelCallCount: number;
    steps: DiscoveryStepView[];
    evidenceDirectory: string;
  };
  draft?: {
    capabilityId: string;
    revision: number;
    stepCount: number;
    inputNames: string[];
    approvalStatus: "draft";
  };
  approval?: {
    approvedBy: string;
    approvedAt: string;
    digest: string;
  };
  replay?: {
    runId: string;
    resultKind: AutomationRunView["resultKind"];
    code: string;
    modelCallCount: number;
  };
}

export interface DemoLifecyclePort {
  view(): DemoLifecycleView;
  runDiscovery(instruction: string, origin: string): Promise<void>;
  approve(reviewer: string): void;
  approvedContactUpdate(): CapabilityPackage | undefined;
  recordReplay(run: AutomationRunView): void;
  reset(): void;
}

export interface DemoLifecycleOptions {
  evidenceRoot?: string;
  now?: () => Date;
  createRunId?: () => string;
  apiKeyProvider?: () => string | undefined;
  modelNameProvider?: () => string;
  modelFactory?: (apiKey: string, modelName: string) => DiscoveryModel;
}

export class DemoLifecycle implements DemoLifecyclePort {
  readonly #evidenceRoot: string;
  readonly #now: () => Date;
  readonly #createRunId: () => string;
  readonly #apiKeyProvider: () => string | undefined;
  readonly #modelNameProvider: () => string;
  readonly #modelFactory: (apiKey: string, modelName: string) => DiscoveryModel;
  readonly #privacy = new PrivacyGateway({ redactEmails: true });
  #status: DemoLifecycleStatus = "discovery_required";
  #busy = false;
  #error: string | undefined;
  #trace: DiscoveryTrace | undefined;
  #draft: CapabilityPackage | undefined;
  #approved: CapabilityPackage | undefined;
  #discoveryView: DemoLifecycleView["discovery"];
  #replay: DemoLifecycleView["replay"];

  constructor(
    readonly repository: MemberRepository,
    readonly scenarios: ScenarioController,
    options: DemoLifecycleOptions = {},
  ) {
    this.#evidenceRoot =
      options.evidenceRoot ?? join(REPOSITORY_ROOT, "evidence", "generated");
    this.#now = options.now ?? (() => new Date());
    this.#createRunId =
      options.createRunId ?? (() => `discovery-${randomUUID()}`);
    this.#apiKeyProvider =
      options.apiKeyProvider ?? (() => process.env.OPENAI_API_KEY);
    this.#modelNameProvider =
      options.modelNameProvider ??
      (() => process.env.OPENAI_MODEL ?? "gpt-6-luna");
    this.#modelFactory =
      options.modelFactory ??
      ((apiKey, modelName) =>
        new OpenAIDiscoveryModel({ apiKey, model: modelName }));
  }

  view(): DemoLifecycleView {
    const approval = this.#approved?.approval;
    return {
      status: this.#status,
      activePhase:
        this.#status === "discovery_required"
          ? 1
          : this.#status === "draft_ready"
            ? 2
            : 3,
      modelConfigured: (this.#apiKeyProvider() ?? "").length > 0,
      modelName: this.#modelNameProvider(),
      busy: this.#busy,
      ...(this.#error === undefined ? {} : { error: this.#error }),
      ...(this.#discoveryView === undefined
        ? {}
        : { discovery: structuredClone(this.#discoveryView) }),
      ...(this.#draft === undefined
        ? {}
        : {
            draft: {
              capabilityId: this.#draft.capability.id,
              revision: this.#draft.capability.revision,
              stepCount: this.#draft.steps.length,
              inputNames: Object.keys(this.#draft.inputs),
              approvalStatus: "draft" as const,
            },
          }),
      ...(approval?.status !== "approved"
        ? {}
        : {
            approval: {
              approvedBy: approval.approvedBy,
              approvedAt: approval.approvedAt,
              digest: approval.digest,
            },
          }),
      ...(this.#replay === undefined
        ? {}
        : { replay: structuredClone(this.#replay) }),
    };
  }

  async runDiscovery(instruction: string, origin: string): Promise<void> {
    if (this.#busy) {
      this.#error = "A discovery run is already in progress.";
      return;
    }
    const inputs = parsePhoneUpdateInstruction(instruction);
    if (inputs === undefined) {
      this.#error =
        "Discovery currently requires an update-phone goal with a member ID and replacement phone number.";
      return;
    }
    const apiKey = this.#apiKeyProvider();
    if (apiKey === undefined || apiKey.length === 0) {
      this.#error =
        "OPENAI_API_KEY is not configured. Add it locally, restart the app, and retry discovery.";
      return;
    }

    this.#busy = true;
    this.#error = undefined;
    this.#trace = undefined;
    this.#draft = undefined;
    this.#approved = undefined;
    this.#discoveryView = undefined;
    this.#replay = undefined;
    this.#status = "discovery_required";
    this.repository.reset();
    this.scenarios.reset();

    const runId = this.#createRunId();
    const evidenceDirectory = join(this.#evidenceRoot, runId);
    const evidenceReference = relative(REPOSITORY_ROOT, evidenceDirectory);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const runner = new DiscoveryRunner({
        model: this.#modelFactory(apiKey, this.#modelNameProvider()),
        surface: new PlaywrightSurfaceAdapter(page, {
          allowedOrigins: [origin],
          allowedRoutes: ["/contacts", "/contacts/*"],
        }),
        evidence: new EvidencePackageWriter(evidenceDirectory, runId, {
          privacyGateway: this.#privacy,
          now: this.#now,
        }),
        privacyGateway: this.#privacy,
        now: this.#now,
      });
      const result = await runner.run({
        runId,
        goal: instruction.trim(),
        startUrl: `${origin}/contacts`,
        inputs: {
          memberId: {
            value: inputs.memberId,
            dataClass: "personal",
            description: "Synthetic member identifier",
          },
          phone: {
            value: inputs.phone,
            dataClass: "personal",
            description: "Replacement synthetic phone number",
          },
        },
        policy: discoveryPolicy(origin),
        verifySuccess: async () =>
          page.url().includes(`/contacts/${inputs.memberId}`) &&
          (await page.getByText(inputs.phone, { exact: true }).isVisible()),
      });

      if (result.kind !== "success") {
        this.#error =
          result.kind === "pending_escalation"
            ? `Discovery requested human control: ${result.reasonCode}.`
            : `Discovery stopped safely: ${result.code}. Check the provider configuration and current browser state, then retry.`;
        return;
      }

      this.#trace = result.trace;
      this.#draft = compileContactUpdateCapability(result.trace, {
        allowedOrigin: origin,
        evidenceManifestRef: `${evidenceReference}/manifest.json`,
        reviewedPolicy: discoveryPolicy(origin),
      });
      this.#discoveryView = {
        runId,
        goal: this.#privacy.sanitizeText(instruction.trim()),
        modelCallCount: result.modelCallCount,
        steps: result.trace.steps.map((step, index) => ({
          number: index + 1,
          action: actionLabel(step.action.type),
          semanticTarget: semanticTargetLabel(step.action),
        })),
        evidenceDirectory: evidenceReference,
      };
      this.#status = "draft_ready";
    } catch {
      this.#error =
        "Discovery could not complete. Check the provider configuration and local browser installation, then retry.";
    } finally {
      try {
        await browser?.close();
      } finally {
        this.repository.reset();
        this.scenarios.reset();
        this.#busy = false;
      }
    }
  }

  approve(reviewer: string): void {
    const normalizedReviewer = reviewer.trim();
    if (this.#draft === undefined || this.#trace === undefined) {
      this.#error =
        "Run a successful LLM discovery before approving a capability.";
      return;
    }
    if (normalizedReviewer.length < 2 || normalizedReviewer.length > 80) {
      this.#error = "Enter a reviewer name between 2 and 80 characters.";
      return;
    }
    const approved = approveCapability(
      this.#draft,
      normalizedReviewer,
      this.#now(),
    );
    const verification = verifyApprovedCapability(approved);
    if (!verification.valid) {
      this.#error = verification.reason;
      return;
    }
    this.#approved = approved;
    this.#status = "approved";
    this.#error = undefined;
  }

  approvedContactUpdate(): CapabilityPackage | undefined {
    return this.#approved === undefined
      ? undefined
      : structuredClone(this.#approved);
  }

  recordReplay(run: AutomationRunView): void {
    if (run.capabilityId !== "contact.update-phone") return;
    this.#replay = {
      runId: run.runId,
      resultKind: run.resultKind,
      code: run.code,
      modelCallCount: run.modelCallCount,
    };
    if (run.resultKind === "success") this.#status = "replay_complete";
  }

  reset(): void {
    this.repository.reset();
    this.scenarios.reset();
    this.#status = "discovery_required";
    this.#busy = false;
    this.#error = undefined;
    this.#trace = undefined;
    this.#draft = undefined;
    this.#approved = undefined;
    this.#discoveryView = undefined;
    this.#replay = undefined;
  }
}

function parsePhoneUpdateInstruction(
  instruction: string,
): { memberId: string; phone: string } | undefined {
  const normalized = instruction.trim();
  if (
    !/\b(?:update|change|set)\b/i.test(normalized) ||
    !/\b(?:phone|telephone|mobile)\b/i.test(normalized)
  ) {
    return undefined;
  }
  const memberId = normalized.match(/\bM-[0-9]{4}\b/i)?.[0]?.toUpperCase();
  const phone = normalized.match(/\b[0-9]{3}[-. ][0-9]{4}\b/)?.[0];
  return memberId === undefined || phone === undefined
    ? undefined
    : { memberId, phone };
}

function discoveryPolicy(origin: string): ExecutionPolicy {
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

function actionLabel(actionType: string): string {
  return (
    {
      click: "Click",
      fill: "Fill from typed input",
      select: "Select",
      navigate: "Navigate",
      capture: "Capture",
    }[actionType] ?? actionType
  );
}

function semanticTargetLabel(
  action: DiscoveryTrace["steps"][number]["action"],
): string {
  if (!("target" in action)) return "Reviewed browser destination";
  const strategy = action.target.strategies[0];
  if (strategy?.type === "role") {
    return `${strategy.role} named “${strategy.name}”`;
  }
  if (strategy?.type === "label") {
    return `field labeled “${strategy.label}”`;
  }
  if (strategy?.type === "text") {
    return `text “${strategy.text}”`;
  }
  return "Reviewed semantic locator";
}
