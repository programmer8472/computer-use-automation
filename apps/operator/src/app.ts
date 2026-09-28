import express, { type Express, type Response } from "express";
import type { BrowserSessionController } from "@computer-use/session";

export function createOperatorApp(session: BrowserSessionController): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/", (_request, response) => {
    response.send(renderOperatorPage(session));
  });

  app.post(
    "/interventions/:interventionId/claim",
    async (request, response) => {
      try {
        await session.claim(readPathParameter(request.params.interventionId));
        response.redirect(303, "/");
      } catch (error) {
        sendConflict(response, error);
      }
    },
  );

  app.post(
    "/interventions/:interventionId/release",
    async (request, response) => {
      try {
        await session.release(readPathParameter(request.params.interventionId));
        response.redirect(303, "/");
      } catch (error) {
        sendConflict(response, error);
      }
    },
  );

  return app;
}

function renderOperatorPage(session: BrowserSessionController): string {
  const intervention = session.currentIntervention;
  const content =
    intervention === undefined
      ? "<p>No intervention is waiting.</p>"
      : `<p><strong>Status:</strong> ${escapeHtml(intervention.status)}</p>
         <p><strong>Browser owner:</strong> ${escapeHtml(intervention.leaseOwner)}</p>
         <p><strong>Reason:</strong> ${escapeHtml(intervention.reason)}</p>
         <dl>${Object.entries(intervention.redactedContext)
           .map(
             ([key, value]) =>
               `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`,
           )
           .join("")}</dl>
         ${renderControl(intervention.interventionId, intervention.status)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Human handoff</title><style>${styles}</style></head><body><main><p class="eyebrow">Same-session control</p><h1>Human handoff</h1>${content}</main></body></html>`;
}

function renderControl(interventionId: string, status: string): string {
  if (status === "requested") {
    return `<form method="post" action="/interventions/${encodeURIComponent(interventionId)}/claim"><button type="submit">Claim browser</button></form>`;
  }
  if (status === "claimed") {
    return `<section role="note"><h2>Complete the protected step</h2><ol><li>Switch to the existing Contacts browser tab.</li><li>Enter the SSN in the masked field and select Save changes.</li><li>Return here and release the browser.</li></ol></section><form method="post" action="/interventions/${encodeURIComponent(interventionId)}/release"><button type="submit">Release and request verified resume</button></form>`;
  }
  if (status === "released") {
    return `<p role="status">Released. Automation is verifying the safe resume checkpoint.</p><form method="post" action="/interventions/${encodeURIComponent(interventionId)}/claim"><button type="submit">Claim again if verification failed</button></form>`;
  }
  return '<p role="status">Automation resumed after checkpoint verification.</p>';
}

function sendConflict(response: Response, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Invalid handoff transition";
  response.status(409).send(message);
}

function readPathParameter(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("A valid intervention ID is required");
  }
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character] ?? character;
  });
}

const styles = `
:root { font-family: system-ui, sans-serif; color: #18212f; background: #f4f6f8; }
main { width: min(720px, calc(100% - 32px)); margin: 48px auto; background: white; border: 1px solid #d8dee7; border-radius: 8px; padding: 24px; }
.eyebrow { color: #526176; font-size: .8rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
dl div { margin: 12px 0; } dt { color: #526176; font-size: .8rem; text-transform: uppercase; } dd { margin: 4px 0; }
section { border-left: 5px solid #b46c00; background: #fff6df; padding: 12px 16px; margin: 18px 0; }
button { border: 1px solid #164b8a; border-radius: 5px; padding: 10px 14px; background: #164b8a; color: white; font: inherit; font-weight: 700; cursor: pointer; }
`;
