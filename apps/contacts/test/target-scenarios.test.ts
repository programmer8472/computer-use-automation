import type { Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createContactsApp } from "../src/app.js";
import { MemberRepository } from "../src/repository.js";
import { ScenarioController } from "../src/scenarios.js";

describe("deterministic target scenarios", () => {
  let server: Server;
  let baseUrl: string;
  let repository: MemberRepository;
  let scenarios: ScenarioController;

  beforeEach(async () => {
    repository = new MemberRepository();
    scenarios = new ScenarioController();
    const app = createContactsApp({ repository, scenarios });
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
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  it("fails one search transiently and succeeds on the next attempt", async () => {
    await activateScenario("transient-search");

    const firstAttempt = await fetch(`${baseUrl}/contacts?q=M-1001`);
    expect(firstAttempt.status).toBe(503);
    expect(await firstAttempt.text()).toContain(
      "Search temporarily unavailable",
    );

    const secondAttempt = await fetch(`${baseUrl}/contacts?q=M-1001`);
    expect(secondAttempt.status).toBe(200);
    expect(await secondAttempt.text()).toContain("Avery Jordan");
  });

  it("renders duplicate visible action names for the ambiguity scenario", async () => {
    await activateScenario("ambiguous-actions");

    const response = await fetch(`${baseUrl}/contacts?q=M-1001`);
    const html = await response.text();
    const desktopEditLinks = html.match(/>Edit<\/a>/g) ?? [];

    expect(response.status).toBe(200);
    expect(desktopEditLinks).toHaveLength(2);
  });

  it("requires dismissal of an unexpected interstitial", async () => {
    await activateScenario("unexpected-dialog");

    const interrupted = await fetch(`${baseUrl}/contacts`);
    expect(await interrupted.text()).toContain('role="dialog"');

    const dismissal = await submit("/admin/scenario/dismiss", {
      returnTo: "/contacts",
    });
    expect(dismissal.status).toBe(303);
    expect(scenarios.active).toBe("normal");

    const resumed = await fetch(`${baseUrl}/contacts`);
    expect(await resumed.text()).not.toContain('role="dialog"');
  });

  it("places the masked human-only SSN field directly on the edit screen", async () => {
    const response = await fetch(`${baseUrl}/contacts/M-1002/edit`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('name="ssn" type="password"');
    expect(html).toContain("Social Security number (human entry only)");
    expect(html).toContain("Current status: <strong>On file</strong>");
    expect(html).not.toContain("Update SSN");

    const detail = await fetch(`${baseUrl}/contacts/M-1002`);
    expect(await detail.text()).not.toContain("/contacts/M-1002/ssn");
  });

  it("accepts an operator-entered SSN on edit without retaining or returning it", async () => {
    const syntheticValue = ["000", "00", "0000"].join("-");
    expect(repository.get("M-1001")?.ssnOnFile).toBe(false);

    const response = await submit("/contacts/M-1001", {
      ...memberFields(),
      ssn: syntheticValue,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/contacts/M-1001?updated=1&ssnUpdated=1",
    );
    expect(repository.get("M-1001")?.ssnOnFile).toBe(true);

    const detail = await fetch(
      `${baseUrl}/contacts/M-1001?updated=1&ssnUpdated=1`,
    );
    const html = await detail.text();
    expect(html).not.toContain(syntheticValue);
    expect(html).toContain("Contact and SSN status updated by the operator.");
    expect(html).toContain("On file");
  });

  it("does not echo an invalid sensitive value", async () => {
    const response = await submit("/contacts/M-1001", {
      ...memberFields(),
      ssn: "invalid-sensitive-input",
    });
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).not.toContain("invalid-sensitive-input");
    expect(html).toContain("Enter a nine-digit value");
    expect(repository.get("M-1001")?.ssnOnFile).toBe(false);
  });

  it("reset clears injected scenarios and sensitive status changes", async () => {
    await activateScenario("ambiguous-actions");
    const syntheticValue = ["000", "00", "0000"].join("-");
    await submit("/contacts/M-1001", {
      ...memberFields(),
      ssn: syntheticValue,
    });

    const reset = await fetch(`${baseUrl}/admin/reset`, { method: "POST" });

    expect(reset.status).toBe(200);
    expect(scenarios.active).toBe("normal");
    expect(repository.get("M-1001")?.ssnOnFile).toBe(false);
  });

  it("retains expected not-found, duplicate, and validation states", async () => {
    const notFound = await fetch(`${baseUrl}/contacts?q=missing-member`);
    expect(await notFound.text()).toContain("No contacts found");

    const duplicate = await submit("/contacts", {
      firstName: "Duplicate",
      lastName: "Member",
      email: "avery.jordan@example.test",
      phone: "555-0202",
      address: "402 Elm Lane, Northbank, NY 10004",
    });
    expect(duplicate.status).toBe(409);

    const invalid = await submit("/contacts", {
      firstName: "",
      lastName: "",
      email: "invalid",
      phone: "x",
      address: "",
    });
    expect(invalid.status).toBe(422);
  });

  it("publishes responsive desktop and mobile result variants", async () => {
    const response = await fetch(`${baseUrl}/contacts`);
    const html = await response.text();
    const stylesResponse = await fetch(`${baseUrl}/assets/styles.css`);
    const css = await stylesResponse.text();

    expect(html).toContain('class="desktop-results table-wrap"');
    expect(html).toContain('class="mobile-results"');
    expect(css).toContain("@media (max-width: 680px)");
    expect(css).toContain(".mobile-results { display: block; }");
  });

  async function activateScenario(scenario: string): Promise<void> {
    const response = await submit("/admin/scenario", { scenario });
    expect(response.status).toBe(303);
  }

  async function submit(
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

  function memberFields(): Record<string, string> {
    return {
      firstName: "Avery",
      lastName: "Jordan",
      email: "avery.jordan@example.test",
      phone: "555-0101",
      address: "101 Maple Street, Northbank, NY 10001",
    };
  }
});
