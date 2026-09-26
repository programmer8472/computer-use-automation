import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createContactsApp } from "../../../apps/contacts/src/app.js";
import { MemberRepository } from "../../../apps/contacts/src/repository.js";
import type { ExecutionPolicy } from "@computer-use/contracts";
import { EvidencePackageWriter, PrivacyGateway } from "@computer-use/evidence";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium, type Browser, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DiscoveryRunner } from "../src/runner.js";
import type {
  DiscoveryInput,
  DiscoveryModel,
  ModelToolCall,
  ModelTurn,
  ModelTurnResult,
} from "../src/types.js";

class ScriptedModel implements DiscoveryModel {
  calls = 0;

  constructor(readonly script: ModelToolCall[]) {}

  nextTurn(turn: ModelTurn): Promise<ModelTurnResult> {
    const call = this.script[this.calls];
    this.calls += 1;
    if (call === undefined) {
      return Promise.resolve({
        responseId: `response-${this.calls}`,
        toolCalls: [],
        outputText: "No scripted call",
      });
    }
    expect(turn.observation.url).toContain("/contacts");
    return Promise.resolve({
      responseId: `response-${this.calls}`,
      toolCalls: [call],
      outputText: "",
    });
  }
}

describe("bounded discovery", () => {
  let server: Server;
  let browser: Browser;
  let page: Page;
  let baseUrl: string;
  let evidenceRoot: string;
  let repository: MemberRepository;

  beforeEach(async () => {
    repository = new MemberRepository();
    const app = createContactsApp({ repository });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    evidenceRoot = await mkdtemp(join(tmpdir(), "discovery-evidence-"));
  });

  afterEach(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  it("uses model decisions to update a contact and records mechanical facts", async () => {
    const model = new ScriptedModel([
      toolCall("click", { role: "link", name: "M-1001" }, 1),
      toolCall("click", { role: "link", name: "Edit contact" }, 2),
      toolCall("fill", { label: "Phone", inputName: "phone" }, 3),
      toolCall("click", { role: "button", name: "Save changes" }, 4),
      toolCall("finish", { summary: "The updated phone is visible." }, 5),
    ]);
    const runner = createRunner(model, "run-success");

    const result = await runner.run(
      request("run-success", async () =>
        Promise.resolve(repository.get("M-1001")?.phone === "555-0199"),
      ),
    );

    expect(result.kind).toBe("success");
    expect(result.modelCallCount).toBe(5);
    expect(repository.get("M-1001")?.phone).toBe("555-0199");
    if (result.kind !== "success") throw new Error("Expected success");
    expect(result.trace.steps).toHaveLength(4);
    expect(JSON.stringify(result.trace)).not.toContain("555-0199");

    const events = await readFile(join(evidenceRoot, "events.jsonl"), "utf8");
    expect(events).toContain('"modelCallCount":5');
    expect(events).not.toContain("555-0199");
    expect(
      await readFile(join(evidenceRoot, "manifest.json"), "utf8"),
    ).toContain('"runId": "run-success"');
  });

  it("blocks sensitive requests before calling the model", async () => {
    const model = new ScriptedModel([]);
    const runner = createRunner(model, "run-sensitive");
    const sensitiveRequest = request("run-sensitive", async () =>
      Promise.resolve(false),
    );
    sensitiveRequest.goal = "Update the SSN for M-1001";
    sensitiveRequest.inputs = {
      ssn: {
        value: "synthetic-sensitive-value",
        dataClass: "full_ssn",
        description: "Protected identifier",
      },
    };

    const result = await runner.run(sensitiveRequest);

    expect(result).toMatchObject({
      kind: "hard_failure",
      code: "SENSITIVE_GOAL_BLOCKED",
      modelCallCount: 0,
    });
    expect(model.calls).toBe(0);
  });

  it("blocks a model-selected disallowed route before clicking", async () => {
    const model = new ScriptedModel([
      toolCall("click", { role: "link", name: "Scenario controls" }, 1),
    ]);
    const runner = createRunner(model, "run-route-blocked");

    const result = await runner.run(
      request("run-route-blocked", async () => Promise.resolve(false)),
    );

    expect(result).toMatchObject({
      kind: "hard_failure",
      code: "DISCOVERY_EXECUTION_FAILED",
      modelCallCount: 1,
    });
    expect(page.url()).toBe(`${baseUrl}/contacts`);
  });

  function createRunner(model: DiscoveryModel, runId: string): DiscoveryRunner {
    const privacy = new PrivacyGateway({ redactEmails: true });
    return new DiscoveryRunner({
      model,
      surface: new PlaywrightSurfaceAdapter(page, {
        allowedOrigins: [baseUrl],
        allowedRoutes: ["/contacts", "/contacts/*"],
      }),
      evidence: new EvidencePackageWriter(evidenceRoot, runId, {
        privacyGateway: privacy,
      }),
      privacyGateway: privacy,
      now: () => new Date("2026-09-25T18:00:00.000Z"),
    });
  }

  function request(
    runId: string,
    verifySuccess: () => Promise<boolean>,
  ): Parameters<DiscoveryRunner["run"]>[0] {
    const inputs: Record<string, DiscoveryInput> = {
      memberId: {
        value: "M-1001",
        dataClass: "personal",
        description: "Synthetic member identifier",
      },
      phone: {
        value: "555-0199",
        dataClass: "personal",
        description: "Replacement synthetic phone",
      },
    };
    return {
      runId,
      goal: "Update the member phone number",
      startUrl: `${baseUrl}/contacts`,
      inputs,
      policy: policy(),
      verifySuccess,
    };
  }

  function policy(): ExecutionPolicy {
    return {
      allowedOrigins: [baseUrl],
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
});

function toolCall(
  name: string,
  arguments_: unknown,
  sequence: number,
): ModelToolCall {
  return { callId: `call-${sequence}`, name, arguments: arguments_ };
}
