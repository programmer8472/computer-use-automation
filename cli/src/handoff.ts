import type { Server } from "node:http";

import { createContactsApp } from "@computer-use/contacts";
import { SCHEMA_VERSION } from "@computer-use/contracts";
import { createOperatorApp } from "@computer-use/operator";
import {
  BrowserSessionController,
  ResumeVerificationError,
  SsnHandoffCoordinator,
} from "@computer-use/session";
import { PlaywrightSurfaceAdapter } from "@computer-use/surface-playwright";
import { chromium } from "playwright";

const memberId = readArgument("--member-id") ?? "M-1001";
const runId = `handoff-${Date.now()}`;
const contactsServer = await listen(createContactsApp());
const contactsUrl = serverUrl(contactsServer);
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 1100, height: 850 },
});
const contactsPage = await context.newPage();
let sequence = 0;
const session = new BrowserSessionController({
  auditSink: (entry) => {
    const event = {
      schemaVersion: SCHEMA_VERSION,
      eventId: `event-${sequence}`,
      runId,
      sequence,
      timestamp: entry.timestamp,
      type: "intervention" as const,
      interventionId: entry.interventionId,
      status: entry.status,
    };
    sequence += 1;
    console.log(JSON.stringify(event));
  },
});
const operatorServer = await listen(createOperatorApp(session));
const operatorUrl = serverUrl(operatorServer);
const coordinator = new SsnHandoffCoordinator(
  new PlaywrightSurfaceAdapter(contactsPage, {
    allowedOrigins: [contactsUrl],
    allowedRoutes: ["/contacts", "/contacts/*"],
  }),
  session,
);

try {
  const intervention = await coordinator.prepare({
    runId,
    memberId,
    startUrl: `${contactsUrl}/contacts`,
  });
  const operatorPage = await context.newPage();
  await operatorPage.goto(operatorUrl);
  console.log(`Human handoff ready at ${operatorUrl}`);
  console.log(
    "Follow the operator-page instructions; the SSN never enters this CLI.",
  );

  let lastReleaseSequence = -1;
  while (session.currentIntervention?.status !== "resumed") {
    const current = session.currentIntervention;
    const latestAudit = session.auditLog.at(-1);
    if (
      current?.status === "released" &&
      latestAudit !== undefined &&
      latestAudit.sequence !== lastReleaseSequence
    ) {
      lastReleaseSequence = latestAudit.sequence;
      try {
        await coordinator.resume(intervention.interventionId);
      } catch (error) {
        if (!(error instanceof ResumeVerificationError)) throw error;
        console.error(
          "Resume check did not pass. Refresh the operator page and claim the browser again.",
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(
    "Handoff completed: the same browser session passed its safe resume checkpoint.",
  );
} finally {
  await browser.close();
  await close(operatorServer);
  await close(contactsServer);
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  return index < 0 || value === undefined || value.startsWith("--")
    ? undefined
    : value;
}

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
