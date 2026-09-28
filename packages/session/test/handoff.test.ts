import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createContactsApp } from "../../../apps/contacts/src/app.js";
import { MemberRepository } from "../../../apps/contacts/src/repository.js";
import { createOperatorApp } from "../../../apps/operator/src/app.js";
import { SCHEMA_VERSION } from "@computer-use/contracts";
import { EvidencePackageWriter } from "@computer-use/evidence";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium, type Browser, type Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BrowserSessionController } from "../src/controller.js";
import { SsnHandoffCoordinator } from "../src/ssn-handoff.js";

describe("same-session SSN handoff", () => {
  let contactsServer: Server | undefined;
  let operatorServer: Server | undefined;
  let browser: Browser | undefined;
  let page: Page;
  let contactsUrl: string;
  let operatorUrl: string;
  let evidenceRoot: string;
  let repository: MemberRepository;

  beforeEach(async () => {
    repository = new MemberRepository();
    const startedContactsServer = await listen(
      createContactsApp({ repository }),
    );
    contactsServer = startedContactsServer;
    contactsUrl = serverUrl(startedContactsServer);
    const launchedBrowser = await chromium.launch({ headless: true });
    browser = launchedBrowser;
    page = await launchedBrowser.newPage({
      viewport: { width: 720, height: 900 },
    });
    evidenceRoot = await mkdtemp(join(tmpdir(), "handoff-evidence-"));
  });

  afterEach(async () => {
    if (browser !== undefined) await browser.close();
    if (operatorServer !== undefined) await close(operatorServer);
    if (contactsServer !== undefined) await close(contactsServer);
    await rm(evidenceRoot, { recursive: true, force: true });
  });

  it("lets a human edit the protected field in the same page and safely resumes", async () => {
    const writer = new EvidencePackageWriter(evidenceRoot, "run-handoff");
    await writer.initialize();
    const session = new BrowserSessionController({
      createId: () => "intervention-handoff-1",
      now: () => new Date("2026-09-26T14:00:00.000Z"),
      auditSink: async (entry) => {
        await writer.appendEvent({
          schemaVersion: SCHEMA_VERSION,
          eventId: `event-${entry.sequence}`,
          runId: "run-handoff",
          sequence: entry.sequence,
          timestamp: entry.timestamp,
          type: "intervention",
          interventionId: entry.interventionId,
          status: entry.status,
        });
      },
    });
    operatorServer = await listen(createOperatorApp(session));
    operatorUrl = serverUrl(operatorServer);
    const coordinator = new SsnHandoffCoordinator(
      new PlaywrightSurfaceAdapter(page, {
        allowedOrigins: [contactsUrl],
        allowedRoutes: ["/contacts", "/contacts/*"],
      }),
      session,
    );

    const intervention = await coordinator.prepare({
      runId: "run-handoff",
      memberId: "M-1001",
      startUrl: `${contactsUrl}/contacts`,
    });
    const handedOffPage = page;

    expect(page.url()).toBe(`${contactsUrl}/contacts/M-1001/edit`);
    expect(
      await page
        .getByLabel("Social Security number (human entry only)")
        .inputValue(),
    ).toBe("");
    expect(session.leaseOwner).toBe("released");

    expect(
      await post(
        `${operatorUrl}/interventions/${intervention.interventionId}/claim`,
      ),
    ).toBe(303);
    expect(session.leaseOwner).toBe("operator");
    expect(() => session.assertOwner("automation")).toThrow();

    const protectedValue = ["321", "54", "9876"].join("-");
    await page
      .getByLabel("Social Security number (human entry only)")
      .fill(protectedValue);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page.waitForURL(/\/contacts\/M-1001\?updated=1&ssnUpdated=1$/);

    expect(page).toBe(handedOffPage);
    expect(repository.get("M-1001")?.ssnOnFile).toBe(true);
    expect(
      await post(
        `${operatorUrl}/interventions/${intervention.interventionId}/release`,
      ),
    ).toBe(303);

    const resumed = await coordinator.resume(intervention.interventionId);
    expect(resumed.status).toBe("resumed");
    expect(session.leaseOwner).toBe("automation");
    expect(session.auditLog.map((entry) => entry.status)).toEqual([
      "requested",
      "claimed",
      "released",
      "resumed",
    ]);

    await writer.finalize();
    const evidence = await readAllText(evidenceRoot);
    expect(evidence).not.toContain(protectedValue);
    expect(evidence).toContain('"status":"resumed"');
  });
});

async function listen(
  app: ReturnType<typeof createContactsApp>,
): Promise<Server> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return server;
}

function serverUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function post(url: string): Promise<number> {
  const response = await fetch(url, { method: "POST", redirect: "manual" });
  return response.status;
}

async function readAllText(directory: string): Promise<string> {
  const entries = await readdir(directory, { recursive: true });
  const files = entries.filter(
    (entry) => entry.endsWith(".json") || entry.endsWith(".jsonl"),
  );
  return (
    await Promise.all(
      files.map(async (entry) => readFile(join(directory, entry), "utf8")),
    )
  ).join("\n");
}
