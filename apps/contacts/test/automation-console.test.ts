import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DiscoveryModel,
  ModelToolCall,
  ModelTurnResult,
} from "@computer-use/discovery";

import {
  AutomationConsole,
  CapabilityInvocationError,
  parseCapabilityInvocation,
  parseAutomationInstruction,
} from "../src/automation.js";
import { createContactsApp } from "../src/app.js";
import { DemoLifecycle } from "../src/demo-lifecycle.js";
import { MemberRepository } from "../src/repository.js";
import { ScenarioController } from "../src/scenarios.js";

describe("Automation Console", () => {
  let server: Server | undefined;
  let evidenceRoot: string | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await close(server);
      server = undefined;
    }
    if (evidenceRoot !== undefined) {
      await rm(evidenceRoot, { recursive: true, force: true });
      evidenceRoot = undefined;
    }
  });

  it("extracts approved capability inputs from natural-language commands", () => {
    expect(
      parseAutomationInstruction(
        "Please update member M-1001's phone number to 555-0199",
      ),
    ).toEqual({
      kind: "update_phone",
      memberId: "M-1001",
      phone: "555-0199",
    });
    expect(parseAutomationInstruction("Find member m-1002")).toEqual({
      kind: "find_member",
      memberId: "M-1002",
    });
    expect(parseAutomationInstruction("Update the SSN for M-1001")).toEqual({
      kind: "human_control",
      reasonCode: "SENSITIVE_DATA_ENTRY_REQUIRED",
      memberId: "M-1001",
    });
  });

  it("validates typed catalog invocations before browser execution", () => {
    expect(
      parseCapabilityInvocation("contact.update-phone", {
        memberId: "M-1001",
        phone: "555-0199",
      }),
    ).toEqual({
      kind: "update_phone",
      memberId: "M-1001",
      phone: "555-0199",
    });
    expect(() =>
      parseCapabilityInvocation("contact.find-member", {
        memberId: "not-a-member",
      }),
    ).toThrowError(CapabilityInvocationError);
    expect(() => parseCapabilityInvocation("unknown", {})).toThrowError(
      /No approved capability/,
    );
  });

  it("renders the member app and testing suite in one two-column workspace", async () => {
    const app = createContactsApp();
    server = await listen(app);
    const response = await fetch(`${serverUrl(server)}/automation`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Member Contacts Automation Lab");
    expect(html).toContain('class="workspace-grid"');
    expect(html).toContain("Application under test");
    expect(html).toContain("Member contacts");
    expect(html).toContain("Search members");
    expect(html).toContain("LLM discovery (“training”)");
    expect(html).toContain("Run approved capability");
    expect(html).toContain("Natural-language instruction");
    expect(html).toContain("Result and exception status");
    expect(html).toContain("ambiguous-actions");
    expect(html).toContain("How to read outcomes");
    expect(html).toContain("M-1001");
    expect(html).not.toContain("Open full Contacts app");
    expect(html).not.toContain("Advanced scenarios");
  });

  it("lets a user search the consolidated member application", async () => {
    server = await listen(createContactsApp());
    const baseUrl = serverUrl(server);

    const matchPage = await fetch(`${baseUrl}/automation?q=Morgan`).then(
      async (response) => response.text(),
    );
    expect(matchPage).toContain("1 matching member for “Morgan”.");
    expect(matchPage).toContain("Morgan Lee");
    expect(matchPage).not.toContain("Avery Jordan");
    expect(matchPage).not.toContain("Riley Patel");
    expect(matchPage).toContain('href="/automation">Clear</a>');

    const emptyPage = await fetch(`${baseUrl}/automation?q=M-9999`).then(
      async (response) => response.text(),
    );
    expect(emptyPage).toContain("No matching members");
    expect(emptyPage).toContain("No member matched “M-9999”");
  });

  it("supports inline create, update, and removal without leaving the workspace", async () => {
    const repository = new MemberRepository();
    const scenarios = new ScenarioController();
    server = await listen(createContactsApp({ repository, scenarios }));
    const baseUrl = serverUrl(server);

    const created = await submitForm(baseUrl, "/automation/members", {
      firstName: "Casey",
      lastName: "Nguyen",
      email: "casey.nguyen@example.test",
      phone: "555-0201",
      address: "401 Elm Lane, Northbank, NY 10004",
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/automation?notice=created");
    expect(repository.get("M-1004")?.firstName).toBe("Casey");

    const updated = await submitForm(baseUrl, "/automation/members/M-1004", {
      firstName: "Casey",
      lastName: "Nguyen",
      email: "casey.nguyen@example.test",
      phone: "555-0299",
      address: "401 Elm Lane, Northbank, NY 10004",
    });
    expect(updated.status).toBe(303);
    expect(repository.get("M-1004")?.phone).toBe("555-0299");

    const deleted = await submitForm(
      baseUrl,
      "/automation/members/M-1004/delete",
      {},
    );
    expect(deleted.status).toBe(303);
    expect(repository.get("M-1004")).toBeUndefined();
  });

  it("immediately reveals duplicate Edit controls for the ambiguity scenario", async () => {
    server = await listen(createContactsApp());
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${serverUrl(server)}/automation`);

      expect(
        await page.locator("[data-ambiguity-control]:visible").count(),
      ).toBe(0);
      await page.locator("#scenario-ambiguous-actions").check();
      expect(
        await page.locator("[data-ambiguity-control]:visible").count(),
      ).toBe(3);
      await expectVisibleText(page, "Ambiguity injected:");

      await page.locator("#scenario-normal").check();
      expect(
        await page.locator("[data-ambiguity-control]:visible").count(),
      ).toBe(0);
    } finally {
      await browser.close();
    }
  });

  it("demonstrates live discovery, explicit approval, deterministic replay, and full reset", async () => {
    const repository = new MemberRepository();
    const scenarios = new ScenarioController();
    evidenceRoot = await mkdtemp(join(tmpdir(), "lifecycle-evidence-"));
    const demo = new DemoLifecycle(repository, scenarios, {
      evidenceRoot,
      createRunId: () => "discovery-lifecycle-1",
      now: () => new Date("2026-09-27T15:00:00.000Z"),
      apiKeyProvider: () => "synthetic-test-key",
      modelNameProvider: () => "scripted-test-model",
      modelFactory: () => new ScriptedDiscoveryModel(),
    });
    server = await listen(createContactsApp({ repository, scenarios, demo }));
    const baseUrl = serverUrl(server);

    const initial = await fetch(`${baseUrl}/automation`).then(
      async (response) => response.text(),
    );
    expect(initial).toContain("Current phase: 1 of 3");
    expect(initial).toContain("Run live LLM discovery");
    expect(initial).toMatch(/id="run-automation" type="submit" disabled/);

    const discovered = await submitForm(baseUrl, "/automation/discover", {
      instruction: "Update member M-1001's phone number to 555-0195",
    });
    expect(discovered.status).toBe(303);
    expect(repository.get("M-1001")?.phone).toBe("555-0101");
    const draftPage = await fetch(`${baseUrl}/automation`).then(
      async (response) => response.text(),
    );
    expect(draftPage).toContain("Current phase: 2 of 3");
    expect(draftPage).toContain("5 LLM calls");
    expect(draftPage).toContain("Approve generated capability");
    expect(draftPage).toContain("field labeled “Phone”");

    const approved = await submitForm(baseUrl, "/automation/approve", {
      reviewer: "Alex Shein",
    });
    expect(approved.status).toBe(303);
    const approvedPage = await fetch(`${baseUrl}/automation`).then(
      async (response) => response.text(),
    );
    expect(approvedPage).toContain("Current phase: 3 of 3");
    expect(approvedPage).toContain("Capability is locked and executable");
    expect(approvedPage).toContain("Alex Shein");
    expect(approvedPage).not.toMatch(
      /id="run-automation" type="submit" disabled/,
    );

    const replayed = await submitCommand(
      baseUrl,
      "Update member M-1001's phone number to 555-0195",
      "normal",
    );
    expect(replayed).toContain("Automation completed");
    expect(replayed).toContain("Model calls during replay</dt><dd>0");
    expect(repository.get("M-1001")?.phone).toBe("555-0195");

    const reset = await submitForm(baseUrl, "/automation/reset", {});
    expect(reset.status).toBe(303);
    expect(repository.get("M-1001")?.phone).toBe("555-0101");
    const resetPage = await fetch(`${baseUrl}/automation`).then(
      async (response) => response.text(),
    );
    expect(resetPage).toContain("Current phase: 1 of 3");
    expect(resetPage).not.toContain("Capability is locked and executable");
  });

  it("discovers and invokes approved capabilities through the typed API", async () => {
    const repository = new MemberRepository();
    const scenarios = new ScenarioController();
    evidenceRoot = await mkdtemp(join(tmpdir(), "catalog-evidence-"));
    const automation = new AutomationConsole(repository, scenarios, {
      evidenceRoot,
      createRunId: () => "catalog-invocation-1",
      now: () => new Date("2026-09-27T14:00:00.000Z"),
    });
    server = await listen(
      createContactsApp({ repository, scenarios, automation }),
    );
    const baseUrl = serverUrl(server);

    const catalogResponse = await fetch(`${baseUrl}/api/capabilities`);
    const catalog = (await catalogResponse.json()) as {
      catalogVersion: string;
      capabilities: Array<{ id: string; inputs: Record<string, unknown> }>;
    };
    expect(catalogResponse.status).toBe(200);
    expect(catalog.catalogVersion).toBe("1.0.0");
    expect(catalog.capabilities.map((entry) => entry.id)).toEqual([
      "contact.update-phone",
      "contact.find-member",
    ]);
    expect(catalog.capabilities[0]?.inputs).toHaveProperty("phone");

    const invocationResponse = await submitJson(
      baseUrl,
      "/api/capabilities/contact.update-phone/invoke",
      {
        inputs: { memberId: "M-1001", phone: "555-0297" },
        scenario: "normal",
      },
    );
    const invocation = (await invocationResponse.json()) as {
      executionMode: string;
      modelCallCount: number;
      outputs: { updated: boolean };
      result: { resultKind: string; code: string; capabilityId: string };
    };
    expect(invocationResponse.status).toBe(200);
    expect(invocation.executionMode).toBe("deterministic_replay");
    expect(invocation.modelCallCount).toBe(0);
    expect(invocation.outputs).toEqual({ updated: true });
    expect(invocation.result).toMatchObject({
      resultKind: "success",
      code: "SUCCESS",
      capabilityId: "contact.update-phone",
    });
    expect(repository.get("M-1001")?.phone).toBe("555-0297");

    const invalidResponse = await submitJson(
      baseUrl,
      "/api/capabilities/contact.update-phone/invoke",
      { inputs: { memberId: "bad", phone: "555-0297" } },
    );
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({
      error: { code: "INVALID_CAPABILITY_INPUTS" },
    });

    const missingResponse = await submitJson(
      baseUrl,
      "/api/capabilities/not-registered/invoke",
      { inputs: {} },
    );
    expect(missingResponse.status).toBe(404);
  });

  it("updates data and presents success, business, recovery, and failure outcomes", async () => {
    const repository = new MemberRepository();
    const scenarios = new ScenarioController();
    evidenceRoot = await mkdtemp(join(tmpdir(), "console-evidence-"));
    let sequence = 0;
    const automation = new AutomationConsole(repository, scenarios, {
      evidenceRoot,
      createRunId: () => {
        sequence += 1;
        return `console-test-${sequence}`;
      },
      now: () => new Date("2026-09-27T14:00:00.000Z"),
    });
    server = await listen(
      createContactsApp({ repository, scenarios, automation }),
    );
    const baseUrl = serverUrl(server);

    const success = await submitCommand(
      baseUrl,
      "Update member M-1001's phone number to 555-0199",
      "normal",
    );
    expect(success).toContain("Automation completed");
    expect(success).toContain("success");
    expect(repository.get("M-1001")?.phone).toBe("555-0199");

    const missing = await submitCommand(
      baseUrl,
      "Find member M-9999",
      "normal",
    );
    expect(missing).toContain("Business outcome");
    expect(missing).toContain("CONTACT_NOT_FOUND");

    const recovered = await submitCommand(
      baseUrl,
      "Find member M-1002",
      "transient-search",
    );
    expect(recovered).toContain("Automation completed");
    expect(recovered).toContain("temporary search failure");

    const ambiguous = await submitCommand(
      baseUrl,
      "Update member M-1002's phone number to 555-0298",
      "ambiguous-actions",
    );
    expect(ambiguous).toContain("Automation stopped safely");
    expect(ambiguous).toContain("AMBIGUOUS_TARGET");
    expect(repository.get("M-1002")?.phone).toBe("555-0102");

    const handoff = await submitCommand(
      baseUrl,
      "Update the SSN for member M-1001",
      "normal",
    );
    expect(handoff).toContain("Complete the protected action as a human");
    expect(handoff).toContain("npm run handoff -- --member-id M-1001");
    expect(handoff).toContain("Claim browser");
    expect(handoff).toContain("Release and request verified resume");
  });

  it("redacts a supplied protected value before displaying an escalation", async () => {
    const repository = new MemberRepository();
    const scenarios = new ScenarioController();
    const automation = new AutomationConsole(repository, scenarios, {
      createRunId: () => "console-sensitive-1",
    });
    const protectedValue = ["321", "54", "9876"].join("-");

    const result = await automation.run(
      `Update SSN ${protectedValue} for M-1001`,
      "normal",
      "http://127.0.0.1:4173",
    );

    expect(result.resultKind).toBe("pending_escalation");
    expect(result.code).toBe("SENSITIVE_DATA_ENTRY_REQUIRED");
    expect(JSON.stringify(result)).not.toContain(protectedValue);
  });
});

async function submitCommand(
  baseUrl: string,
  instruction: string,
  scenario: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/automation/run`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ instruction, scenario }),
    redirect: "manual",
  });
  expect(response.status).toBe(303);
  const location = response.headers.get("location");
  if (location === null) throw new Error("Expected automation redirect");
  return fetch(`${baseUrl}${location}`).then(async (result) => result.text());
}

async function submitForm(
  baseUrl: string,
  path: string,
  fields: Record<string, string>,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

async function submitJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectVisibleText(page: Page, text: string): Promise<void> {
  expect(await page.getByText(text, { exact: false }).isVisible()).toBe(true);
}

async function listen(
  app: ReturnType<typeof createContactsApp>,
): Promise<Server> {
  const activeServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    activeServer.once("listening", resolve);
    activeServer.once("error", reject);
  });
  return activeServer;
}

function serverUrl(activeServer: Server): string {
  const address = activeServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

class ScriptedDiscoveryModel implements DiscoveryModel {
  #index = 0;
  readonly #script: ModelToolCall[] = [
    scriptedToolCall("click", { role: "link", name: "M-1001" }, 1),
    scriptedToolCall("click", { role: "link", name: "Edit contact" }, 2),
    scriptedToolCall("fill", { label: "Phone", inputName: "phone" }, 3),
    scriptedToolCall("click", { role: "button", name: "Save changes" }, 4),
    scriptedToolCall("finish", { summary: "Updated phone is visible" }, 5),
  ];

  nextTurn(): Promise<ModelTurnResult> {
    const call = this.#script[this.#index];
    this.#index += 1;
    return Promise.resolve({
      responseId: `scripted-response-${this.#index}`,
      toolCalls: call === undefined ? [] : [call],
      outputText: "",
    });
  }
}

function scriptedToolCall(
  name: string,
  arguments_: unknown,
  sequence: number,
): ModelToolCall {
  return { callId: `scripted-call-${sequence}`, name, arguments: arguments_ };
}

async function close(activeServer: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) =>
      error === undefined ? resolve() : reject(error),
    );
  });
}
